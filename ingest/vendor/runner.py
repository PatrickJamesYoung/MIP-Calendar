#!/usr/bin/env python3
"""DC Events Tracker — corrected 14-column runner with proper Grassroots DC parsing.

Outputs candidates_final.json with 14-field rows ready for sheet append.
"""
import json
import re
import html
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from bs4 import BeautifulSoup
from difflib import SequenceMatcher

# External source parser modules (kept outside runner.py per convention).
# Only the sources loop in main() references these.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from parse_metro_dc_dsa import parse_metro_dc_dsa as _parse_metro_dc_dsa_ext  # noqa: E402

# RUN_DIR resolution order:
#   1. $RUN_DIR env var (preferred: caller sets it)
#   2. $PWD if the current directory contains raw_freedc.json or is under cron_tracking/37024eca/
#   3. fallback: cron_tracking/37024eca/run_$(date_utc)_auto  (creates fresh dir)
import os as _os
_env_run_dir = _os.environ.get('RUN_DIR')
if _env_run_dir:
    RUN_DIR = Path(_env_run_dir)
elif (Path.cwd() / 'raw_freedc.json').exists() or 'cron_tracking/37024eca/run_' in str(Path.cwd()):
    RUN_DIR = Path.cwd()
else:
    _cron_dir = Path('/home/user/workspace/cron_tracking/37024eca')
    RUN_DIR = _cron_dir / ('run_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '_auto')
    RUN_DIR.mkdir(parents=True, exist_ok=True)
print(f'[runner] RUN_DIR = {RUN_DIR}', file=sys.stderr)
ET = timezone(timedelta(hours=-4))  # EDT
NOW = datetime.now(ET)
TODAY = NOW.date()
RUN_DATE_ISO = NOW.strftime('%Y-%m-%dT%H:%M ET')

# 14-column schema
COLUMNS = ['run_date','source','title','date','time','end_time','location','host','rsvp_link','event_url','image_url','description','movement_calendar','submit']

# ---- Helpers ----

def clean_html(s):
    if not s: return ''
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def fmt_date(d):
    """date -> M/D/YYYY no leading zeros"""
    return f'{d.month}/{d.day}/{d.year}'

def fmt_time(dt):
    """datetime/time -> H:MM AM/PM no leading zero on hour"""
    if dt is None:
        return ''
    s = dt.strftime('%I:%M %p').lstrip('0')
    return s

def parse_iso_dt(s):
    """Parse ISO 8601 and treat naive or +00:00 from PopVille as ET local."""
    if not s:
        return None
    s = s.replace('Z', '+00:00')
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    # PopVille tags +00:00 but actually means local time. Strip tz, treat as ET.
    return dt.replace(tzinfo=None)

def normalize_title(t):
    return re.sub(r'\s+', ' ', t.lower().strip()) if t else ''

def normalize_date(d):
    return d.strip() if d else ''

# ---- Parsers ----

def parse_freedc():
    events = []
    try:
        data = json.loads((RUN_DIR / 'raw_freedc.json').read_text())
    except Exception as e:
        print(f'[Free DC] parse fail: {e}', file=sys.stderr)
        return events
    items = data.get('upcoming', []) or data.get('items', [])
    for it in items:
        ms = it.get('startDate')
        if not ms:
            continue
        dt = datetime.fromtimestamp(ms / 1000, tz=ET)
        if dt.date() < TODAY:
            continue
        # End date if available
        end_ms = it.get('endDate')
        end_dt = datetime.fromtimestamp(end_ms / 1000, tz=ET) if end_ms else None
        if end_dt and end_dt <= dt:
            end_dt = None
        loc = it.get('location') or {}
        loc_str = loc.get('addressTitle') or loc.get('addressLine1') or ''
        if loc.get('addressLine1') and loc.get('addressTitle'):
            loc_str = f"{loc.get('addressTitle')}, {loc.get('addressLine1')}"
        events.append({
            'source': 'Free DC',
            'title': clean_html(it.get('title') or ''),
            'date': fmt_date(dt.date()),
            'time': fmt_time(dt),
            'end_time': fmt_time(end_dt) if end_dt else '',
            'location': loc_str,
            'host': 'Free DC',
            'rsvp_link': '',
            'event_url': 'https://freedcproject.org' + (it.get('fullUrl') or ''),
            'image_url': it.get('assetUrl') or '',
            'description': clean_html(it.get('excerpt') or it.get('body') or '')[:1000],
        })
    return events

def parse_busboys():
    events = []
    try:
        data = json.loads((RUN_DIR / 'raw_busboys.json').read_text())
    except Exception as e:
        print(f'[Busboys] parse fail: {e}', file=sys.stderr)
        return events
    if isinstance(data, dict):
        items = data.get('Events') or data.get('events') or []
    elif isinstance(data, list):
        items = data
    else:
        items = []
    for it in items:
        acf = it.get('acf') or {}
        date_s = acf.get('date_start') or acf.get('date') or it.get('date')
        time_s = acf.get('time_start') or ''
        if not date_s:
            continue
        try:
            d = datetime.strptime(date_s, '%Y-%m-%d').date()
        except Exception:
            try:
                d = datetime.strptime(date_s, '%m/%d/%Y').date()
            except Exception:
                continue
        if d < TODAY:
            continue
        # Time
        time_fmt = ''
        if time_s:
            for fmt in ('%H:%M:%S', '%H:%M', '%I:%M %p'):
                try:
                    t = datetime.strptime(time_s, fmt)
                    time_fmt = fmt_time(t)
                    break
                except Exception:
                    pass
        title = clean_html((it.get('title') or {}).get('rendered') or '')
        events.append({
            'source': 'Busboys & Poets',
            'title': title,
            'date': fmt_date(d),
            'time': time_fmt,
            'end_time': '',
            'location': acf.get('location_name') or '',
            'host': 'Busboys and Poets',
            'rsvp_link': '',
            'event_url': it.get('link') or '',
            'image_url': acf.get('image') or '',
            'description': clean_html(acf.get('short_description') or (it.get('excerpt') or {}).get('rendered') or '')[:1000],
        })
    return events

def parse_popville():
    events = []
    try:
        html_text = (RUN_DIR / 'raw_popville.html').read_text()
    except Exception as e:
        print(f'[PopVille] read fail: {e}', file=sys.stderr)
        return events
    soup = BeautifulSoup(html_text, 'html.parser')
    items = soup.select('.event-list-item')
    for it in items:
        # Title + url
        title_a = it.select_one('article > a[href]')
        if not title_a:
            continue
        title = title_a.get_text(strip=True)
        url = title_a.get('href', '')

        # Times
        time_nodes = it.select('time[datetime]')
        start_dt = end_dt = None
        if len(time_nodes) >= 1:
            start_dt = parse_iso_dt(time_nodes[0].get('datetime'))
        if len(time_nodes) >= 2:
            end_dt = parse_iso_dt(time_nodes[1].get('datetime'))

        if not start_dt:
            continue
        if start_dt.date() < TODAY:
            continue

        # Location
        addr_node = it.select_one('address')
        if addr_node:
            # Get text but strip duplicate whitespace
            location = re.sub(r'\s+', ' ', addr_node.get_text(' ', strip=True))
        else:
            location = ''

        events.append({
            'source': 'PopVille',
            'title': clean_html(title),
            'date': fmt_date(start_dt.date()),
            'time': fmt_time(start_dt),
            'end_time': fmt_time(end_dt) if end_dt else '',
            'location': location,
            'host': '',
            'rsvp_link': '',
            'event_url': url,
            'image_url': '',
            'description': '',
        })
    return events

def parse_grassroots():
    """Properly parse Squarespace eventlist-event blocks."""
    events = []
    try:
        html_text = (RUN_DIR / 'raw_grassroots.html').read_text()
    except Exception as e:
        print(f'[Grassroots] read fail: {e}', file=sys.stderr)
        return events
    soup = BeautifulSoup(html_text, 'html.parser')
    nodes = soup.select('.eventlist-event')
    for n in nodes:
        title_link = n.select_one('.eventlist-title-link, .eventlist-title a')
        if not title_link:
            continue
        title = title_link.get_text(strip=True)
        href = title_link.get('href', '')
        if href.startswith('/'):
            url = 'https://grassrootsdc.org' + href
        else:
            url = href

        # Date
        date_node = n.select_one('time.event-date, .eventlist-meta-date time')
        if not date_node:
            continue
        date_attr = date_node.get('datetime', '')
        try:
            ev_date = datetime.strptime(date_attr, '%Y-%m-%d').date()
        except Exception:
            continue
        if ev_date < TODAY:
            continue

        # Times
        time_nodes = n.select('.eventlist-meta-time time')
        start_t = end_t = ''
        if time_nodes:
            def fix_time_str(s):
                # "10:00 AM" with weird unicode
                s = s.replace('\u202f', ' ').replace('\xa0', ' ').strip()
                try:
                    dt = datetime.strptime(s, '%I:%M %p')
                    return fmt_time(dt)
                except Exception:
                    return s
            start_t = fix_time_str(time_nodes[0].get_text(strip=True))
            if len(time_nodes) >= 2:
                end_t = fix_time_str(time_nodes[1].get_text(strip=True))

        # Address
        addr_node = n.select_one('.eventlist-meta-address')
        location = ''
        if addr_node:
            location = re.sub(r'\s+', ' ', addr_node.get_text(' ', strip=True))
            # strip trailing "(map)"
            location = re.sub(r'\s*\(map\)\s*$', '', location).strip()

        # Image
        img = n.select_one('img[data-image]')
        img_url = img.get('data-image') if img else ''

        # Excerpt (often empty)
        excerpt = n.select_one('.eventlist-excerpt, .eventlist-description, .sqs-block-content')
        desc = clean_html(str(excerpt)) if excerpt else ''
        desc = desc[:1000]

        events.append({
            'source': 'Grassroots DC',
            'title': clean_html(title),
            'date': fmt_date(ev_date),
            'time': start_t,
            'end_time': end_t,
            'location': location,
            'host': 'Grassroots DC',
            'rsvp_link': '',
            'event_url': url,
            'image_url': img_url,
            'description': desc,
        })
    return events

def parse_mobilize():
    events = []
    # Mobilize org allowlist. This is the ONLY sanctioned edit to runner.py:
    # add or remove org IDs here as the watchlist grows. Do not modify any
    # other logic in this file (see handoff packet lessons.md).
    orgs = {
        1723: 'DC Working Families Party',
        32348: 'One Fair Wage',
        2339: 'Popular Democracy',
        1377: 'Color Of Change',
        34282: "Harriet's Wildest Dreams",
        93: 'Indivisible',
        7229: 'John Lewis Actions',
    }
    VIRTUAL = {'PHONE_BANK', 'TEXT_BANK', 'VIRTUAL_PHONE_BANK', 'VIRTUAL_TEXT_BANK'}
    for oid, oname in orgs.items():
        p = RUN_DIR / f'raw_mobilize_{oid}.json'
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        for ev in (data.get('data') or []):
            etype = ev.get('event_type') or ''
            if etype in VIRTUAL:
                continue
            loc = ev.get('location') or {}
            region = (loc.get('region') or '').upper()
            locality = (loc.get('locality') or '').lower()
            if region != 'DC' and locality != 'washington':
                continue
            # First timeslot
            slots = ev.get('timeslots') or []
            future = []
            for s in slots:
                start = s.get('start_date')
                if not start:
                    continue
                try:
                    dt = datetime.fromtimestamp(int(start), tz=ET)
                except Exception:
                    continue
                if dt.date() >= TODAY:
                    future.append(dt)
            if not future:
                continue
            dt = min(future)

            # Address handling
            addr_lines = loc.get('address_lines') or []
            addr = ', '.join([a for a in addr_lines if a and a.strip()])
            full_addr = addr
            city_state_zip = []
            if loc.get('locality'):
                city_state_zip.append(loc.get('locality'))
            if loc.get('region'):
                city_state_zip.append(loc.get('region'))
            if loc.get('postal_code'):
                city_state_zip.append(loc.get('postal_code'))
            if city_state_zip:
                full_addr = (full_addr + ', ' if full_addr else '') + ', '.join(city_state_zip)
            if not full_addr or re.search(r'private', full_addr, re.I):
                full_addr = (full_addr or 'Washington, DC') + ' (address private — RSVP for details)'

            events.append({
                'source': 'Mobilize',
                'title': clean_html(ev.get('title') or ''),
                'date': fmt_date(dt.date()),
                'time': fmt_time(dt),
                'end_time': '',
                'location': full_addr,
                'host': oname,
                'rsvp_link': '',
                'event_url': ev.get('browser_url') or '',
                'image_url': ev.get('featured_image_url') or '',
                'description': clean_html(ev.get('description') or '')[:1000],
            })
    return events

def parse_rhizome():
    events = []
    try:
        html_text = (RUN_DIR / 'raw_rhizome.html').read_text()
    except Exception:
        return events
    soup = BeautifulSoup(html_text, 'html.parser')
    nodes = soup.select('.eventlist-event')
    for n in nodes:
        title_link = n.select_one('.eventlist-title-link, .eventlist-title a')
        if not title_link:
            continue
        title = title_link.get_text(strip=True)
        href = title_link.get('href', '')
        url = 'https://www.rhizomedc.org' + href if href.startswith('/') else href

        date_node = n.select_one('time.event-date, .eventlist-meta-date time')
        if not date_node:
            continue
        try:
            ev_date = datetime.strptime(date_node.get('datetime', ''), '%Y-%m-%d').date()
        except Exception:
            continue
        if ev_date < TODAY:
            continue

        time_nodes = n.select('.eventlist-meta-time time')
        def fix_t(s):
            s = s.replace('\u202f', ' ').replace('\xa0', ' ').strip()
            try:
                return fmt_time(datetime.strptime(s, '%I:%M %p'))
            except Exception:
                return s
        start_t = fix_t(time_nodes[0].get_text(strip=True)) if time_nodes else ''
        end_t = fix_t(time_nodes[1].get_text(strip=True)) if len(time_nodes) >= 2 else ''

        addr_node = n.select_one('.eventlist-meta-address')
        loc = ''
        if addr_node:
            loc = re.sub(r'\s+', ' ', addr_node.get_text(' ', strip=True))
            loc = re.sub(r'\s*\(map\)\s*$', '', loc).strip()

        img = n.select_one('img[data-image]')
        events.append({
            'source': 'Rhizome DC',
            'title': clean_html(title),
            'date': fmt_date(ev_date),
            'time': start_t,
            'end_time': end_t,
            'location': loc or '6950 Maple St NW, Washington, DC 20012',
            'host': 'Rhizome DC',
            'rsvp_link': '',
            'event_url': url,
            'image_url': img.get('data-image') if img else '',
            'description': '',
        })
    return events

def parse_festival_center():
    """Parse iCal feed for The Festival Center (imported Google Calendar).
    Source ID: uulp2pem0sbujuv1lm7nq774jkkqahb5@import.calendar.google.com
    Raw file: raw_festival_center.ics
    """
    events = []
    try:
        content = (RUN_DIR / 'raw_festival_center.ics').read_text()
    except Exception as e:
        print(f'[Festival Center] read fail: {e}', file=sys.stderr)
        return events

    def unescape_ics(s):
        return (s.replace('\\n', '\n').replace('\\,', ',').replace('\\;', ';').replace('\\\\', '\\'))

    def unfold(block):
        # ICS continuation: lines starting with a space or tab continue the previous line
        return re.sub(r'\r?\n[\t ]', '', block)

    def get_field(block, key):
        # Match KEY[;params]:value up to end of (unfolded) line
        m = re.search(rf'^{key}(;[^:]*)?:(.*)$', block, re.MULTILINE)
        if not m:
            return ''
        return unescape_ics(m.group(2).strip())

    def parse_ical_dt(raw):
        """Return timezone-aware datetime in ET, or None."""
        if not raw:
            return None
        s = raw.strip()
        # DTSTART:20260712T180000Z  or DTSTART;TZID=America/New_York:20260712T140000
        # or DTSTART;VALUE=DATE:20260712 (all-day)
        if 'T' in s:
            try:
                if s.endswith('Z'):
                    dt = datetime.strptime(s, '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
                else:
                    dt = datetime.strptime(s, '%Y%m%dT%H%M%S').replace(tzinfo=ET)
                return dt.astimezone(ET)
            except Exception:
                return None
        else:
            # date-only
            try:
                d = datetime.strptime(s, '%Y%m%d').replace(tzinfo=ET)
                return d
            except Exception:
                return None

    for raw_block in re.findall(r'BEGIN:VEVENT(.*?)END:VEVENT', content, re.DOTALL):
        block = unfold(raw_block)
        summary = get_field(block, 'SUMMARY')
        if not summary:
            continue
        dtstart_raw = get_field(block, 'DTSTART')
        dtend_raw = get_field(block, 'DTEND')
        url = get_field(block, 'URL')
        loc = get_field(block, 'LOCATION')
        desc = get_field(block, 'DESCRIPTION')

        start_dt = parse_ical_dt(dtstart_raw)
        end_dt = parse_ical_dt(dtend_raw)
        if not start_dt:
            continue
        if start_dt.date() < TODAY:
            continue
        if end_dt and end_dt <= start_dt:
            end_dt = None

        # Strip ical-escape trailing chars
        summary = re.sub(r'\s+', ' ', summary).strip()
        desc = re.sub(r'\s+', ' ', desc).strip()

        events.append({
            'source': 'Festival Center',
            'title': summary,
            'date': fmt_date(start_dt.date()),
            'time': fmt_time(start_dt),
            'end_time': fmt_time(end_dt) if end_dt else '',
            'location': loc or 'The Festival Center, 1640 Columbia Rd NW, Washington, DC 20009',
            'host': 'The Festival Center',
            'rsvp_link': '',
            'event_url': url,
            'image_url': '',
            'description': desc[:1000],
        })
    return events

# ---- Trumba ----

def load_trumba():
    try:
        data = json.loads((RUN_DIR / 'raw_trumba.json').read_text())
    except Exception:
        return [], None, None
    items = data if isinstance(data, list) else (data.get('items') or data.get('events') or [])
    pairs = []
    dates = []
    for it in items:
        title = it.get('title') or it.get('eventTitle') or ''
        # Trumba uses "startDateTime" or "startDate"
        sd = it.get('startDateTime') or it.get('startDate') or it.get('start')
        if not sd:
            continue
        try:
            # Could be ISO string
            if isinstance(sd, str):
                # strip timezone designator
                ds = sd[:10]
                dt = datetime.strptime(ds, '%Y-%m-%d').date()
            else:
                continue
        except Exception:
            continue
        pairs.append((title, dt))
        dates.append(dt)
    if dates:
        return pairs, min(dates), max(dates)
    return pairs, None, None

def trumba_match(ev_title, ev_date_str, trumba_pairs, trumba_min, trumba_max):
    try:
        m, d, y = ev_date_str.split('/')
        ev_d = datetime(int(y), int(m), int(d)).date()
    except Exception:
        return 'Not Posted'
    if not trumba_pairs or not trumba_min:
        return 'Not Posted'
    if ev_d < trumba_min or ev_d > trumba_max:
        return 'Not Posted'
    tnorm = normalize_title(ev_title)
    # Free DC prefix won't be in Trumba — strip it for matching
    tnorm_no_prefix = re.sub(r'^free dc\s+', '', tnorm)
    for tt, td in trumba_pairs:
        if abs((td - ev_d).days) <= 1:
            ratio = max(
                SequenceMatcher(None, tnorm, normalize_title(tt)).ratio(),
                SequenceMatcher(None, tnorm_no_prefix, normalize_title(tt)).ratio(),
            )
            if ratio >= 0.72:
                return 'Posted'
    return 'Not Posted'

# ---- Build row (14 cols) ----

def build_row(ev, run_date_iso):
    title = ev['title']
    # Free DC prefix enforced here
    if ev['source'] == 'Free DC' and not title.lower().startswith('free dc'):
        title = 'Free DC ' + title

    return [
        run_date_iso,
        ev['source'],
        title,
        ev['date'],
        ev['time'],
        ev['end_time'],
        ev['location'],
        ev['host'],
        ev['rsvp_link'],
        ev['event_url'],
        ev['image_url'],
        ev['description'],
        ev['movement_calendar'],
        ev['submit'],
    ]

# ---- Main ----

def main():
    print(f'Run date: {RUN_DATE_ISO}')
    print(f'Today: {TODAY}')

    all_events = []
    for fn, label in [
        (parse_freedc, 'Free DC'),
        (parse_busboys, 'Busboys & Poets'),
        (parse_popville, 'PopVille'),
        (parse_grassroots, 'Grassroots DC'),
        (parse_mobilize, 'Mobilize'),
        (parse_rhizome, 'Rhizome DC'),
        (parse_festival_center, 'Festival Center'),
        (lambda: _parse_metro_dc_dsa_ext(RUN_DIR), 'Metro DC DSA'),
    ]:
        try:
            evs = fn()
            print(f'  {label}: {len(evs)} events')
            all_events.extend(evs)
        except Exception as e:
            print(f'  {label}: FAIL {e}', file=sys.stderr)

    # Apply Free DC prefix early for dedup match against sheet (sheet titles already have prefix)
    for ev in all_events:
        if ev['source'] == 'Free DC' and not ev['title'].lower().startswith('free dc'):
            ev['title'] = 'Free DC ' + ev['title']

    # Dedup vs existing sheet
    existing = json.loads((RUN_DIR / 'existing_rows.json').read_text())
    # rows have [source, title, date, time]
    seen = set()
    for r in existing:
        if len(r) >= 3:
            seen.add((r[0].strip().lower(), normalize_title(r[1]), normalize_date(r[2])))

    new_events = []
    for ev in all_events:
        key = (ev['source'].strip().lower(), normalize_title(ev['title']), normalize_date(ev['date']))
        if key not in seen:
            new_events.append(ev)
            seen.add(key)

    print(f'\nNew after dedup: {len(new_events)}')

    # Trumba
    trumba_pairs, tmin, tmax = load_trumba()
    print(f'Trumba pairs: {len(trumba_pairs)} | range: {tmin} → {tmax}')
    for ev in new_events:
        ev['movement_calendar'] = trumba_match(ev['title'], ev['date'], trumba_pairs, tmin, tmax)

    # Classify Submit
    AUTO_SUBMIT_SOURCES = {'Free DC', 'Grassroots DC', 'Rhizome DC', 'Mobilize', 'Festival Center'}
    for ev in new_events:
        if ev['movement_calendar'] == 'Posted':
            ev['submit'] = "Don't Submit"
        elif ev['source'] in AUTO_SUBMIT_SOURCES:
            ev['submit'] = 'Submit'
        else:
            # PopVille / Busboys need LLM — placeholder 'Don't Submit' by default
            ev['submit'] = "Don't Submit"

    # Save the events needing LLM classification separately
    needs_llm = [ev for ev in new_events if ev['source'] in ('PopVille', 'Busboys & Poets')]
    (RUN_DIR / 'needs_llm.json').write_text(json.dumps(needs_llm, indent=1))
    print(f'Needs LLM: {len(needs_llm)}')

    (RUN_DIR / 'new_events.json').write_text(json.dumps(new_events, indent=1))
    print(f'\nWrote {len(new_events)} new events to new_events.json')

    # Summary by source
    from collections import Counter
    print('\nNew events by source:')
    for k, v in Counter(ev['source'] for ev in new_events).most_common():
        print(f'  {k}: {v}')

if __name__ == '__main__':
    main()
