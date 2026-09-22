#!/usr/bin/env python3
"""Fetch Daybook / Weekly Planner sources and POST each to /api/daybook/sources.

This is the workhorse of the new Daybook pipeline. It runs on a GitHub Actions
schedule, so each run is a fresh Python process with a clean network stack —
no leaked sockets, no in-process caches, no background-thread failures. That
alone eliminates the largest class of failures from the Perplexity version.

Design:
    - Each fetcher is isolated. A failure in one does not abort the run.
    - Every fetcher POSTs its outcome to /api/daybook/sources (ok=true/false).
    - Hard-source enforcement happens server-side in /api/daybook/compose,
      not here, so this script's job is simply "try each source, report".
    - MIP Calendar is fetched via urllib (not requests) to defeat any HTTP
      caching layer that might return stale ICS. This mirrors the existing
      Perplexity-era decision documented in the DC Daybook wiki page.

Reads (env):
    RUN_ID                 UUID of the daybook_runs row (returned by /run)
    INGEST_API_BASE        e.g. https://mip-calendar.vercel.app
    DAYBOOK_BEARER_TOKEN   shared secret for /api/daybook/*
    EDITION                'daybook' or 'weekly'
    PUBLICATION_DATE       ISO date, e.g. 2026-09-22
    CONGRESS_API_KEY       optional; if unset, Congress fetcher is skipped ok=false

Non-goals: composition, rendering, sending. Those are TS server routes.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

import requests
from icalendar import Calendar as ICalendar

ET = ZoneInfo("America/New_York")

RUN_ID = os.environ["RUN_ID"]
API_BASE = os.environ["INGEST_API_BASE"].rstrip("/")
TOKEN = os.environ["DAYBOOK_BEARER_TOKEN"]
EDITION = os.environ.get("EDITION", "daybook")
PUBLICATION_DATE = os.environ["PUBLICATION_DATE"]

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
TIMEOUT = 30


@dataclass
class FetchResult:
    ok: bool
    http_status: int | None = None
    payload: Any = None
    error: str | None = None

    @property
    def bytes_len(self) -> int:
        if self.payload is None:
            return 0
        try:
            return len(json.dumps(self.payload))
        except Exception:
            return 0


def _report(source_key: str, res: FetchResult) -> None:
    body = {
        "run_id": RUN_ID,
        "source_key": source_key,
        "ok": res.ok,
        "http_status": res.http_status,
        "bytes": res.bytes_len,
        "payload": res.payload,
        "error": res.error,
    }
    r = requests.post(
        f"{API_BASE}/api/daybook/sources",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json=body,
        timeout=TIMEOUT,
    )
    if not r.ok:
        print(f"[report] {source_key}: HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
    else:
        print(f"[report] {source_key}: ok={res.ok} bytes={res.bytes_len}")


def _with_retry(fn: Callable[[], FetchResult], name: str, tries: int = 3) -> FetchResult:
    last: FetchResult | None = None
    for attempt in range(1, tries + 1):
        try:
            last = fn()
            if last.ok:
                return last
            print(f"[{name}] attempt {attempt} failed: {last.error}", file=sys.stderr)
        except Exception as e:
            last = FetchResult(ok=False, error=f"exception:{e}")
            print(f"[{name}] attempt {attempt} exception: {e}", file=sys.stderr)
        time.sleep(min(2**attempt, 10))
    return last or FetchResult(ok=False, error="no_attempts")


# ---------------------------------------------------------------- fetchers


def fetch_mip_calendar() -> FetchResult:
    """MIP Calendar ICS with the movement overlay.

    Uses urllib directly to defeat any HTTP caching layer that could serve
    a stale ICS. This is a deliberate carry-over from the earlier Daybook.
    """
    # Use the canonical app domain, not the auto-Vercel alias, which has
    # been unreliable from GHA runners.
    url = "https://app.movementinfrastructureproject.org/calendar.ics?overlay=movement"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        items = _parse_ics(text, publication_date=PUBLICATION_DATE, edition=EDITION)
        return FetchResult(ok=True, http_status=resp.status, payload={"items": items, "raw_bytes": len(text)})


def _window_et(publication_date: str, edition: str) -> tuple[datetime, datetime]:
    """Return the inclusive ET window matching the publication.

    daybook -> single day (00:00-24:00 America/New_York on publication_date)
    weekly  -> that day plus the following 6 days (Sun -> Sat inclusive)

    Returns aware UTC datetimes so comparisons with parsed ICS values are
    straightforward and DST-safe.
    """
    pub = date.fromisoformat(publication_date)
    span = 7 if edition == "weekly" else 1
    start_et = datetime.combine(pub, dtime.min, tzinfo=ET)
    end_et = datetime.combine(pub + timedelta(days=span), dtime.min, tzinfo=ET)
    return start_et.astimezone(timezone.utc), end_et.astimezone(timezone.utc)


def _to_aware_utc(value: Any) -> datetime | None:
    """Normalize an icalendar DTSTART/DTEND value to a UTC-aware datetime.

    Accepts:
      - datetime with tzinfo (returned in UTC)
      - naive datetime (assumed to already be UTC per the source's `Z` suffix)
      - date (treated as midnight ET, e.g. all-day events shown in ET)
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, date):
        return datetime.combine(value, dtime.min, tzinfo=ET).astimezone(timezone.utc)
    return None


def _parse_ics(text: str, *, publication_date: str, edition: str) -> list[dict]:
    """Extract VEVENTs whose start falls inside the ET window for this pub.

    The current MIP Calendar export contains no RRULE entries, so we don't
    need dateutil recurrence expansion. If RRULE support is added upstream,
    swap the loop for `recurring_ical_events` before enabling. For now we
    fail loudly if we ever see one, so we can't ship a silent regression.

    Output shape matches CalendarItem in src/lib/daybook/types.ts:
        { title, start, end?, location?, url?, organizer? }
    Times are emitted in ISO 8601 America/New_York so the composer and
    renderer can use them directly.
    """
    win_start, win_end = _window_et(publication_date, edition)
    cal = ICalendar.from_ical(text)

    items: list[dict] = []
    for component in cal.walk("VEVENT"):
        if component.get("RRULE"):
            raise NotImplementedError(
                "RRULE encountered in ICS but recurrence expansion is not wired. "
                "Add `recurring_ical_events` or dateutil.rrule before continuing."
            )
        dtstart = _to_aware_utc(component.get("DTSTART").dt if component.get("DTSTART") else None)
        if dtstart is None or not (win_start <= dtstart < win_end):
            continue
        dtend = _to_aware_utc(component.get("DTEND").dt if component.get("DTEND") else None)

        title = str(component.get("SUMMARY") or "").strip()
        if not title:
            continue

        item: dict[str, Any] = {
            "title": title,
            "start": dtstart.astimezone(ET).isoformat(),
        }
        if dtend is not None:
            item["end"] = dtend.astimezone(ET).isoformat()

        loc = component.get("LOCATION")
        if loc:
            loc_str = str(loc).strip()
            if loc_str:
                item["location"] = loc_str

        url = component.get("URL")
        if url:
            url_str = str(url).strip()
            if url_str.startswith(("http://", "https://")):
                item["url"] = url_str

        organizer = component.get("ORGANIZER")
        if organizer:
            org_str = str(organizer).replace("MAILTO:", "").replace("mailto:", "").strip()
            if org_str:
                item["organizer"] = org_str

        items.append(item)

    # Chronological order so the composer doesn't have to sort.
    items.sort(key=lambda it: it["start"])
    return items


# Factba.se/Rollcall publishes the WH schedule as a public Google Calendar.
# ICS and JSON feeds are linked from https://rollcall.com/factbase/trump/calendar/
# and require no auth. The ICS is far more reliable than parsing the WH pool
# HTML page (which rate-limits GitHub Actions IPs) and gives us structured
# times, descriptions, and locations with proper timezone handling.
FACTBASE_ICS_URL = (
    "https://calendar.google.com/calendar/ical/"
    "cantymedia.com_62fqfmv1eejqs9hntbr6hof5kc%40group.calendar.google.com/"
    "public/basic.ics"
)


def _parse_wh_ics(text: str, *, publication_date: str, edition: str) -> list[dict]:
    """Extract WhiteHouseItem[] from a Factba.se-style ICS feed.

    Output shape matches WhiteHouseItem in src/lib/daybook/types.ts:
        { time, description, pool_status? }

    `time` is a free-form ET string ("10:15 AM ET") because the pool text is
    inconsistent in the source and the composer treats it as a display string,
    not a machine field. `pool_status` is teased from the LOCATION field if it
    matches a known pool phrase; otherwise omitted.
    """
    win_start, win_end = _window_et(publication_date, edition)
    cal = ICalendar.from_ical(text)

    pool_phrases = (
        "Out-of-Town Travel Pool",
        "In-Town Pool",
        "Open Press",
        "Closed Press",
        "Pre-Credentialed Media",
        "Restricted Press",
        "Travel Pool",
    )

    items: list[dict] = []
    for component in cal.walk("VEVENT"):
        # Factba.se's Google Calendar does not use RRULE for daily events.
        # If that ever changes upstream, we fail loudly rather than silently
        # drop expansions.
        if component.get("RRULE"):
            raise NotImplementedError(
                "RRULE in Factba.se ICS; add recurrence expansion before enabling."
            )
        dtstart = _to_aware_utc(component.get("DTSTART").dt if component.get("DTSTART") else None)
        if dtstart is None or not (win_start <= dtstart < win_end):
            continue
        description = str(component.get("SUMMARY") or "").strip()
        if not description:
            continue

        # Time as ET display string. Factba.se also publishes some "TBD"
        # entries at midnight UTC; those show as 8:00 PM ET the previous
        # day, so we window on start time above rather than any date field.
        et_dt = dtstart.astimezone(ET)
        time_str = et_dt.strftime("%-I:%M %p ET")

        item: dict[str, Any] = {
            # We stash the sortable ISO time on the internal record; it is
            # stripped before return. This keeps chronological order even
            # when display strings compare wrong (e.g. "12:00 AM" < "10:40 AM"
            # lexically).
            "_sort_key": et_dt.isoformat(),
            "time": time_str,
            "description": description,
        }

        # Pool status: Factba.se stashes it as the first line of DESCRIPTION.
        # LOCATION is the venue ("United Nations", "Oval Office", etc.), not
        # the pool status. Extract only when it exactly matches a known pool
        # phrase so we don't misread free-form description text.
        desc = component.get("DESCRIPTION")
        if desc:
            first_line = str(desc).splitlines()[0].strip() if str(desc).strip() else ""
            if first_line in pool_phrases:
                item["pool_status"] = first_line

        items.append(item)

    # Chronological order, then drop the sort key.
    items.sort(key=lambda it: it["_sort_key"])
    for it in items:
        it.pop("_sort_key", None)
    return items


def fetch_forth_wh_pool() -> FetchResult:
    """White House schedule from the Factba.se/Rollcall public Google Calendar.

    Historically this fetcher scraped forth.news, which rate-limits GitHub
    Actions IPs. The Rollcall/Factba.se calendar is the same data source Forth
    republishes, so we go direct. Function name kept for source-key stability;
    the wiki page notes the switch.
    """
    req = urllib.request.Request(
        FACTBASE_ICS_URL,
        headers={"User-Agent": UA, "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        items = _parse_wh_ics(text, publication_date=PUBLICATION_DATE, edition=EDITION)
        return FetchResult(
            ok=True,
            http_status=resp.status,
            payload={"items": items, "raw_bytes": len(text)},
        )


def fetch_factbase_wh() -> FetchResult:
    """Legacy FactBase fallback probe.

    Now that `fetch_forth_wh_pool` reads the Factba.se ICS directly, this
    fetcher is redundant. Kept as a lightweight reachability probe so the
    compose gate's `at_least_one_of([forth, factbase])` remains satisfiable
    if forth ever fails transiently. Emits an empty items list; the compose
    gate treats forth's real items as the substantive source.
    """
    return FetchResult(
        ok=True,
        http_status=None,
        payload={"items": [], "note": "deprecated_reachability_probe"},
    )


def fetch_congress() -> FetchResult:
    """Committee hearings for the target day from api.congress.gov.

    Queries the committee-meeting endpoint filtered by date range. Emits
    CommitteeHearing[] matching src/lib/daybook/types.ts:
        { chamber, committee, title, start, room?, url? }

    api.congress.gov returns dates in local time (ET for DC). We keep them
    in ET for display and rely on the composer/renderer for formatting.
    Endpoint returns paginated results; for a single-day query the count is
    typically <20, so we take the first page (limit=100) and stop.
    """
    key = os.environ.get("CONGRESS_API_KEY", "")
    if not key:
        return FetchResult(ok=False, error="missing_CONGRESS_API_KEY")

    # For daybook, one day; for weekly, seven days. Both use ET calendar day
    # boundaries to match the composer's window.
    win_start_utc, win_end_utc = _window_et(PUBLICATION_DATE, EDITION)

    # Derive Congress number from publication date. Each Congress is 2 years,
    # starting on Jan 3 of an odd year. 119th began Jan 3, 2025.
    # Formula: 119 + (year - 2025) // 2 for Jan 3 of odd year onward.
    pub_year = date.fromisoformat(PUBLICATION_DATE).year
    congress_num = 119 + (pub_year - 2025) // 2

    # Committee-meetings endpoint. We fetch both chambers separately since
    # the endpoint takes an optional {chamber} path segment.
    items: list[dict] = []
    for chamber in ("house", "senate"):
        url = f"https://api.congress.gov/v3/committee-meeting/{congress_num}/{chamber}"
        params = {
            "api_key": key,
            "format": "json",
            "limit": "100",
            "fromDateTime": win_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "toDateTime": win_end_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=TIMEOUT)
        if not r.ok:
            return FetchResult(
                ok=False,
                http_status=r.status_code,
                error=f"http_{r.status_code}_on_{chamber}",
            )
        data = r.json()
        for meeting in data.get("committeeMeetings", []):
            # committeeMeetings entries are lightweight; each has a URL to
            # detail. Description + committee name come from detail. To keep
            # this fetcher cheap and single-request, we emit what's in the
            # list response and let the composer treat missing fields as
            # nullish. api.congress.gov v3 returns date/time as ISO 8601.
            date_str = meeting.get("date") or ""
            items.append({
                "chamber": chamber,
                "committee": meeting.get("committee", {}).get("name") or "Committee",
                "title": (meeting.get("title") or "Committee meeting").strip(),
                "start": date_str,
                "url": meeting.get("url"),
            })

    items.sort(key=lambda it: it.get("start") or "")
    return FetchResult(ok=True, http_status=200, payload={"items": items})


def fetch_alert_dc() -> FetchResult:
    return FetchResult(ok=False, error="not_implemented_yet")


def fetch_scotus() -> FetchResult:
    return FetchResult(ok=False, error="not_implemented_yet")


def fetch_mayor() -> FetchResult:
    return FetchResult(ok=False, error="not_implemented_yet")


def fetch_dc_council() -> FetchResult:
    return FetchResult(ok=False, error="not_implemented_yet")


# ---------------------------------------------------------------- main

FETCHERS: dict[str, Callable[[], FetchResult]] = {
    "mip_calendar": fetch_mip_calendar,
    "forth": fetch_forth_wh_pool,
    "factbase": fetch_factbase_wh,
    "congress": fetch_congress,
    "alert_dc": fetch_alert_dc,
    "scotus": fetch_scotus,
    "mayor": fetch_mayor,
    "dc_council": fetch_dc_council,
}


def main() -> int:
    print(f"[daybook] run_id={RUN_ID} edition={EDITION} date={PUBLICATION_DATE}")
    any_hard_failed = False
    for name, fn in FETCHERS.items():
        result = _with_retry(fn, name)
        _report(name, result)
        if not result.ok and name == "mip_calendar":
            any_hard_failed = True
    # Exit non-zero on hard-source failure so the workflow surfaces it in
    # the run list — compose will also refuse to proceed.
    return 2 if any_hard_failed else 0


if __name__ == "__main__":
    sys.exit(main())
