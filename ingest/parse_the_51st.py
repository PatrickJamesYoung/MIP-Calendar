"""The 51st "Civics Roundup" parser.

The 51st (https://51st.news) publishes a weekly "N ways to build a better
D.C. this week" post under the Civics Roundup tag. fetch_sources.py saves
the tag's Ghost RSS feed to:

    raw_the_51st.xml

The feed's <content:encoded> carries the full post HTML, which is very
regular:

    <h3 id="tuesday-sept-22">TUESDAY, SEPT. 22</h3>
    <p><a href="RSVP_URL"><strong>Event title</strong></a><br>
       &#x23f0; 6 - 8 p.m.<br>
       &#x1f4cd; Venue (Address)<br>
       Blurb text ... RSVP <a href="...">here</a>.</p>

We walk each post's top-level elements in order, tracking the current day
header, and turn each <p> whose first meaningful child is a <strong>
(optionally wrapped in <a>) into an event dict in runner.py's shape.

The trailing "Council / ANC / WMATA" resource table and other non-event
paragraphs have no <strong> title + ⏰ line, so they're skipped.
"""

from __future__ import annotations

import html as _html
import re
import warnings
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning, NavigableString, Tag

# Short <br>-split fragments (e.g. "⏰ 7 p.m.") trip bs4's "looks like a
# filename" heuristic; it's noise for us.
warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)

SOURCE = "The 51st"

# Only look at roundups published in the last N days. Posts go up weekly
# (Mon/Tue); 10 days gives one full week of overlap so a late-week run
# still sees the current post, without re-reading stale ones.
_MAX_POST_AGE_DAYS = 10

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

# "TUESDAY, SEPT. 22" / "Saturday, Sept 26" / "MONDAY, OCT. 5"
_DAY_HEADER_RE = re.compile(
    r"^\s*[A-Za-z]+day\s*,\s*([A-Za-z]+)\.?\s+(\d{1,2})\s*$", re.IGNORECASE
)

# One side of a time range: "6", "6:30", "6 p.m.", "10:30 a.m.", "noon"
_TIME_PART = r"(?:noon|midnight|\d{1,2}(?::\d{2})?\s*(?:[ap]\.?\s*m\.?)?)"
_TIME_RANGE_RE = re.compile(
    rf"^\s*(?P<start>{_TIME_PART})\s*(?:[-\u2013\u2014]|to)\s*(?P<end>{_TIME_PART})",
    re.IGNORECASE,
)
_TIME_SINGLE_RE = re.compile(rf"(?<![\w:])(?P<start>{_TIME_PART})", re.IGNORECASE)

# Query params that are pure tracking noise.
_TRACKING_PARAMS = {
    "ref", "fbclid", "gclid", "mc_cid", "mc_eid", "igshid",
    # Action Network / Mobilize email-blast tracking
    "link_id", "can_id", "email_referrer", "email_subject",
    # Eventbrite affiliate tag
    "aff",
}


# ---------------------------------------------------------------------------
# helpers


def _clean_url(url: str) -> str:
    """Drop utm_* / fbclid / ?ref=51st.news tracking params."""
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip()
    q = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
        and k.lower() not in _TRACKING_PARAMS
        and not (k.lower() == "source" and v.lower().startswith("email"))
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))


def _slug(s: str) -> str:
    s = re.sub(r"[^\w\s-]", "", s.lower())
    return re.sub(r"[\s_-]+", "-", s).strip("-")[:80]


def _parse_time_part(raw: str) -> tuple[int, int, str | None] | None:
    """'6:30 p.m.' -> (6, 30, 'PM'); '6' -> (6, 0, None); 'noon' -> (12, 0, 'PM')."""
    s = raw.strip().lower()
    if s == "noon":
        return 12, 0, "PM"
    if s == "midnight":
        return 12, 0, "AM"
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?$", s)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if not 1 <= h <= 12 or mi > 59:
        return None
    mer = m.group(3).upper() + "M" if m.group(3) else None
    return h, mi, mer


def _fmt(h: int, mi: int, mer: str) -> str:
    """runner.py fmt_time() convention: 'H:MM AM'."""
    return f"{h}:{mi:02d} {mer}"


def parse_time_line(line: str) -> tuple[str, str]:
    """Parse the ⏰ line into (start, end) in 'H:MM AM' form.

    Handles '6 - 8 p.m.', '6:30 - 8:30 p.m.', '7 p.m.', '12 - 2 p.m.',
    '11 a.m. - 2 p.m.', '10 - 1 p.m.' (start inferred as AM), 'noon - 3 p.m.'.
    Returns ('', '') when we can't make sense of it (e.g. 'All day') — the
    normalizer treats an empty time as all-day.
    """
    line = line.strip()
    m = _TIME_RANGE_RE.match(line)
    if m:
        s = _parse_time_part(m.group("start"))
        e = _parse_time_part(m.group("end"))
        if s and e:
            eh, emi, emer = e
            sh, smi, smer = s
            if emer is None:
                # "6 - 8" with no meridiem anywhere: assume evening.
                emer = smer or "PM"
            if smer is None:
                # Borrow the end's meridiem, unless that would put start
                # after end on the clock ("10 - 1 p.m." -> 10 AM).
                smer = emer
                s24 = (sh % 12) + (12 if smer == "PM" else 0)
                e24 = (eh % 12) + (12 if emer == "PM" else 0)
                if s24 > e24 and emer == "PM":
                    smer = "AM"
            return _fmt(sh, smi, smer), _fmt(eh, emi, emer)
    # Prefixed forms: "Doors 5 p.m., show 5:30 p.m.", "Starts at 5 p.m.",
    # "Meet at 10:30 a.m.; hike begins at 11 a.m." -> first explicit time.
    for m in _TIME_SINGLE_RE.finditer(line):
        s = _parse_time_part(m.group("start"))
        if s and s[2]:
            return _fmt(s[0], s[1], s[2]), ""
    return "", ""


def _resolve_date(month_name: str, day: int, published: date) -> date | None:
    # Accept "SEPT.", "Sep", "SEPTEMBER", "August", ...
    month = _MONTHS.get(month_name.lower().rstrip(".")[:3])
    if not month:
        return None
    year = published.year
    # A late-December post can list early-January events.
    if month < published.month - 6:
        year += 1
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _split_on_br(p: Tag) -> list[BeautifulSoup]:
    """Split a <p> into lines at every <br>, wherever it's nested.

    Older posts nest the <br> inside a <strong> ("<strong> <br>⏰</strong>"),
    so splitting on direct children isn't enough. We split the raw inner
    HTML and re-parse each fragment; html.parser tolerates the resulting
    unbalanced tags.
    """
    inner = p.decode_contents()
    return [BeautifulSoup(frag, "html.parser") for frag in re.split(r"<br\s*/?>", inner)]


def _text(frag: BeautifulSoup) -> str:
    # Join with "" (not " ") so inline tags don't grow stray spaces:
    # "(<a>sign up here</a>)" should read "(sign up here)".
    return re.sub(r"\s+", " ", _html.unescape(frag.get_text(""))).strip()


def _parse_event_p(p: Tag, event_date: date, post_url: str) -> dict | None:
    lines = _split_on_br(p)
    if len(lines) < 2:
        return None
    head = lines[0]
    # The first non-whitespace element of the first line must be the bold
    # title (optionally wrapped in a link).
    first = next(
        (n for n in head.contents if not (isinstance(n, NavigableString) and not n.strip())),
        None,
    )
    if not isinstance(first, Tag) or first.name not in ("a", "strong", "b"):
        return None
    strong = first if first.name in ("strong", "b") else first.find(["strong", "b"])
    if strong is None:
        return None
    title = re.sub(r"\s+", " ", _html.unescape(strong.get_text(" "))).strip()
    if not title:
        return None
    link = ""
    anchor = first if first.name == "a" else strong.find_parent("a")
    if anchor is not None and anchor.get("href"):
        link = anchor["href"]

    time_line = loc_line = ""
    desc_parts: list[str] = []
    # Emoji markers can trail the title on the same line in older posts,
    # so scan the title line too (minus the title text itself).
    for i, frag in enumerate(lines):
        t = _text(frag)
        if i == 0:
            t = t.replace(title, "", 1).strip()
        if not t:
            continue
        if t.startswith("\u23f0") and not time_line:
            time_line = t.lstrip("\u23f0").strip()
        elif t.startswith("\U0001f4cd") and not loc_line:
            loc_line = t.lstrip("\U0001f4cd").strip()
        elif i > 0:
            desc_parts.append(t)
            # Fall back: the blurb often carries the only RSVP link.
            if not link:
                a = frag.find("a", href=True)
                if a is not None:
                    link = a["href"]

    # A real listing always has the ⏰ line. This filters out stray bold
    # paragraphs (intros, the resources table, promo blurbs).
    if not time_line:
        return None

    start, end = parse_time_line(time_line)
    location = loc_line
    if re.match(r"^virtual\s+or\s+", location, re.IGNORECASE):
        location = "Hybrid: " + location

    description = " ".join(desc_parts).strip()
    attribution = f"Via The 51st Civics Roundup: {post_url}"
    description = f"{description}\n\n{attribution}" if description else attribution

    return {
        "source": SOURCE,
        "title": title,
        "date": f"{event_date.month}/{event_date.day}/{event_date.year}",
        "time": start,
        "end_time": end,
        "location": location,
        "host": "",
        "rsvp_link": _clean_url(link),
        # Stable per-listing id for /api/ingest/submissions dedup: the post
        # URL + a date/title anchor. Survives the post being re-read on
        # later daily runs.
        "event_url": f"{post_url}#{event_date.isoformat()}-{_slug(title)}",
        "image_url": "",
        "description": description,
    }


# ---------------------------------------------------------------------------
# entry points


def parse_post_html(content_html: str, post_url: str, published: date) -> list[dict]:
    soup = BeautifulSoup(content_html, "html.parser")
    events: list[dict] = []
    current: date | None = None
    for el in soup.find_all(["h2", "h3", "h4", "p"]):
        if el.name in ("h2", "h3", "h4"):
            m = _DAY_HEADER_RE.match(el.get_text(" ").strip())
            current = _resolve_date(m.group(1), int(m.group(2)), published) if m else None
            continue
        if current is None:
            continue
        ev = _parse_event_p(el, current, post_url)
        if ev:
            events.append(ev)

    # Editorial slip guard: if two listings in the same post share an RSVP
    # link, the later one is almost always a copy-paste error (seen
    # 2026-09-22: "H Street Unity Day" linked to the Cop Watch RSVP). Keep
    # the first, blank the rest -- no link beats a wrong link.
    used: set[str] = set()
    for ev in events:
        if ev["rsvp_link"] and ev["rsvp_link"] in used:
            ev["rsvp_link"] = ""
        elif ev["rsvp_link"]:
            used.add(ev["rsvp_link"])
    return events


_CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}encoded"


def _iter_feed_items(xml: str):
    """Yield (link, published_date, content_html) per RSS item.

    Uses stdlib ElementTree (CI doesn't install lxml, which bs4's "xml"
    mode needs).
    """
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return
    for item in root.iter("item"):
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        content = item.findtext(_CONTENT_NS) or ""
        if not (link and pub and content):
            continue
        try:
            published = parsedate_to_datetime(pub).date()
        except (TypeError, ValueError):
            continue
        yield link, published, content


def parse_the_51st(run_dir: Path, today: date | None = None) -> list[dict]:
    """Read raw_the_51st.xml and return upcoming events from recent roundups."""
    today = today or date.today()
    path = run_dir / "raw_the_51st.xml"
    if not path.exists():
        return []
    xml = path.read_text(encoding="utf-8", errors="replace")
    if not xml.strip():
        return []

    cutoff = today - timedelta(days=_MAX_POST_AGE_DAYS)
    seen: set[str] = set()
    events: list[dict] = []
    for link, published, content in _iter_feed_items(xml):
        if published < cutoff:
            continue
        for ev in parse_post_html(content, link, published):
            m, d, y = ev["date"].split("/")
            if date(int(y), int(m), int(d)) < today:
                continue
            key = ev["event_url"]
            if key in seen:
                continue
            seen.add(key)
            events.append(ev)
    return events


if __name__ == "__main__":  # manual smoke test: python parse_the_51st.py RUN_DIR [YYYY-MM-DD]
    import json
    import sys

    rd = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    td = datetime.strptime(sys.argv[2], "%Y-%m-%d").date() if len(sys.argv) > 2 else None
    print(json.dumps(parse_the_51st(rd, td), indent=1, ensure_ascii=False))
