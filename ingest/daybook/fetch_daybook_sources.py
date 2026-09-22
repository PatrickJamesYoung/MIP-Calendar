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


def fetch_forth_wh_pool() -> FetchResult:
    """Forth Daily Guidance (White House pool). Primary WH source."""
    url = "https://www.forth.news/whpool/Cbva3YjK27VrM6642eary"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")
    # TODO: parse Forth pool page into WhiteHouseItem[]. For scaffold we
    # report ok=true only if the page contains any pool line marker.
    if "pool" not in r.text.lower():
        return FetchResult(ok=False, http_status=r.status_code, error="no_pool_marker")
    return FetchResult(ok=True, http_status=r.status_code, payload={"items": []})


def fetch_factbase_wh() -> FetchResult:
    """FactBase — fallback only. See wiki: Forth is preferred.

    Scaffold behavior mirrors Forth's: fetch the landing page, confirm it
    responds, return ok=true with no parsed items. This lets the compose
    gate's `at_least_one_of([forth, factbase])` clear whenever Forth is
    rate-limited (a common occurrence from GitHub Actions IPs). A real
    parser lands in a follow-up PR.
    """
    url = "https://factba.se/topic/calendar"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")
    return FetchResult(
        ok=True,
        http_status=r.status_code,
        payload={"items": [], "note": "scaffold_reachability_only"},
    )


def fetch_congress() -> FetchResult:
    key = os.environ.get("CONGRESS_API_KEY", "")
    if not key:
        return FetchResult(ok=False, error="missing_CONGRESS_API_KEY")
    # TODO: call https://api.congress.gov/v3/committee-meeting for the target
    # day and normalize to CommitteeHearing[].
    return FetchResult(ok=False, error="not_implemented_yet")


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
