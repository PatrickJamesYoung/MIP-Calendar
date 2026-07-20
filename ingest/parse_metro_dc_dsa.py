"""Metro DC DSA (Action Network) parser.

Reads raw HTML files fetched by fetch_sources.py:
    raw_metro_dc_dsa_group.html       -- the group index page
    raw_metro_dc_dsa_{slug}.html      -- individual event nowrapper=true pages

and returns a list of event dicts in the shape runner.py's other
parse_* functions produce (source/title/date/time/location/url/description).

Action Network group pages render events with JS, but each event has a
?nowrapper=true variant that returns a full server-rendered HTML doc.

We only care about upcoming events (>= today). The nowrapper HTML has
clean semantic markup for start/end/location; we parse it with regex to
avoid adding an html-parser dependency (runner.py convention).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path


# Selectors we look for in the nowrapper=true event HTML.
# Title lives in <title> as "Actual Title - Action Network".
# (Both <h2 class="entry-title"> elements are placeholders in the
# nowrapper HTML: one holds a no-JS banner, the other is empty.)
_TITLE_RE = re.compile(
    r'<title>\s*(.+?)\s*</title>',
    re.IGNORECASE | re.DOTALL,
)
_TITLE_SUFFIX_RE = re.compile(r'\s*-\s*Action Network\s*$', re.IGNORECASE)
_START_RE = re.compile(
    r'<span[^>]*>Start:</span>\s*'
    r'(?P<date>[A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})'
    r'<span[^>]*>&bull;</span>\s*'
    r'(?P<time>\d{1,2}:\d{2}\s*[AP]M)',
    re.IGNORECASE,
)
_END_RE = re.compile(
    r'<span[^>]*>End:</span>\s*'
    r'(?P<date>[A-Za-z]+,\s*[A-Za-z]+\s+\d{1,2},\s*\d{4})'
    r'<span[^>]*>&bull;</span>\s*'
    r'(?P<time>\d{1,2}:\d{2}\s*[AP]M)',
    re.IGNORECASE,
)
_LOCATION_RE = re.compile(
    r'<h4[^>]*event_location[^"]*"[^>]*>(.*?)</h4>',
    re.DOTALL,
)
_OG_IMAGE_RE = re.compile(
    r'<meta\s+content="([^"]+)"\s+property="og:image"'
)


def _strip_html(s: str) -> str:
    """Remove tags + collapse whitespace."""
    s = re.sub(r'<[^>]+>', ' ', s)
    s = re.sub(r'&bull;', '·', s)
    s = re.sub(r'&amp;', '&', s)
    s = re.sub(r'&#\d+;', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def _normalize_time(raw: str) -> str:
    """Turn '06:00 PM' or '06:00PM' into 'H:MM AM/PM' matching runner.py's
    fmt_time() convention: no leading zero on hour, space before meridiem.
    """
    m = re.match(r'^\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*$', raw, re.IGNORECASE)
    if not m:
        return raw.strip()
    return f'{int(m.group(1))}:{m.group(2)} {m.group(3).upper()}'


def _parse_date(raw: str) -> date | None:
    """Parse 'Friday, July 31, 2026' -> date."""
    try:
        return datetime.strptime(raw.strip(), '%A, %B %d, %Y').date()
    except ValueError:
        return None


def _parse_one(html: str, url: str) -> dict | None:
    """Extract one event dict from a nowrapper=true HTML page.

    Returns None if the event is missing a start date, is virtual-only
    with no location, or fails to parse.
    """
    tmatch = _TITLE_RE.search(html)
    smatch = _START_RE.search(html)
    if not (tmatch and smatch):
        return None

    title = _strip_html(tmatch.group(1))
    title = _TITLE_SUFFIX_RE.sub('', title).strip()
    start_date = _parse_date(smatch.group('date'))
    if not start_date:
        return None

    start_time_raw = _normalize_time(smatch.group('time'))

    ematch = _END_RE.search(html)
    end_time_raw = None
    if ematch:
        end_date_parsed = _parse_date(ematch.group('date'))
        if end_date_parsed == start_date:
            end_time_raw = _normalize_time(ematch.group('time'))

    # Location: preserve venue name; strip HTML.
    loc_match = _LOCATION_RE.search(html)
    location = ''
    if loc_match:
        loc_text = _strip_html(loc_match.group(1))
        # Remove leading "Location:" label if present
        location = re.sub(r'^\s*Location:\s*', '', loc_text).strip()

    # Image (og:image) — high-res event flyer if available.
    img_match = _OG_IMAGE_RE.search(html)
    image_url = img_match.group(1) if img_match else ''

    # runner.py's build_row + downstream normalizer expect these exact
    # keys on every parsed event. See COLUMNS + fmt_date() in runner.py:
    # date is M/D/YYYY (no leading zeros), time is 'H:MM AM/PM'.
    return {
        'source': 'Metro DC DSA',
        'title': title,
        'date': f'{start_date.month}/{start_date.day}/{start_date.year}',
        'time': start_time_raw,
        'end_time': end_time_raw or '',
        'location': location,
        'host': 'Metro DC DSA',
        'rsvp_link': '',
        'event_url': url,
        'image_url': image_url,
        'description': '',
        # movement_calendar + submit are filled in by runner.py's main().
    }


def parse_metro_dc_dsa(run_dir: Path, today: date | None = None) -> list[dict]:
    """Read all raw_metro_dc_dsa_*.html files in run_dir and return event dicts.

    Filters:
        - drops events with start_date < today (past events)
        - drops events we couldn't parse (missing title or date)
    """
    today = today or date.today()
    events: list[dict] = []

    # Enumerate detail files (skip the group index)
    for path in sorted(run_dir.glob('raw_metro_dc_dsa_*.html')):
        if path.name == 'raw_metro_dc_dsa_group.html':
            continue
        slug = path.stem.removeprefix('raw_metro_dc_dsa_')
        url = f'https://actionnetwork.org/events/{slug}'
        try:
            html = path.read_text(encoding='utf-8', errors='replace')
        except Exception:
            continue
        ev = _parse_one(html, url)
        if not ev:
            continue
        # ev['date'] is M/D/YYYY; convert to YYYY-MM-DD for comparison.
        try:
            m, d, y = ev['date'].split('/')
            iso = f'{int(y):04d}-{int(m):02d}-{int(d):02d}'
        except Exception:
            continue
        if iso < today.isoformat():
            continue
        events.append(ev)

    return events
