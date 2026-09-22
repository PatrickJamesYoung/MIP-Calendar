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
from typing import Any, Callable

import requests

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
    url = "https://mip-calendar.vercel.app/calendar.ics?overlay=movement"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        items = _parse_ics(text, publication_date=PUBLICATION_DATE, edition=EDITION)
        return FetchResult(ok=True, http_status=resp.status, payload={"items": items, "raw_bytes": len(text)})


def _parse_ics(text: str, *, publication_date: str, edition: str) -> list[dict]:
    """Extract VEVENTs falling on the target day (or Mon–Sun week for 'weekly').

    Uses the `icalendar` library for VEVENT + RRULE expansion. Times are
    normalized to America/New_York ISO 8601 strings so the TS compose
    route can trust the shape.
    """
    from datetime import date, datetime, time, timedelta
    from zoneinfo import ZoneInfo

    try:
        import icalendar  # type: ignore[import-not-found]
        from dateutil.rrule import rrulestr  # type: ignore[import-not-found]
    except ImportError:
        # Dependencies added to ingest/requirements.txt; if missing at
        # runtime, we fail closed rather than pretending zero events.
        raise RuntimeError("icalendar and python-dateutil are required for _parse_ics")

    tz = ZoneInfo("America/New_York")
    pub = date.fromisoformat(publication_date)
    if edition == "weekly":
        # Publication is Sunday for the week Mon–Sun of the *following* week.
        start_day = pub + timedelta(days=1)
        end_day = start_day + timedelta(days=6)
    else:
        start_day = pub
        end_day = pub
    window_start = datetime.combine(start_day, time.min, tz)
    window_end = datetime.combine(end_day, time.max, tz)

    cal = icalendar.Calendar.from_ical(text)
    items: list[dict] = []

    def _to_dt(v) -> datetime:
        if isinstance(v, datetime):
            return v.astimezone(tz) if v.tzinfo else v.replace(tzinfo=tz)
        return datetime.combine(v, time.min, tz)

    for comp in cal.walk("VEVENT"):
        dtstart = comp.get("DTSTART")
        if dtstart is None:
            continue
        base_start = _to_dt(dtstart.dt)
        dtend = comp.get("DTEND")
        base_end = _to_dt(dtend.dt) if dtend else None

        occurrences: list[datetime] = []
        rrule = comp.get("RRULE")
        if rrule:
            # icalendar returns RRULE as a dict; rebuild the string form.
            rrule_str = rrule.to_ical().decode() if hasattr(rrule, "to_ical") else str(rrule)
            rule = rrulestr(f"RRULE:{rrule_str}", dtstart=base_start)
            occurrences = list(rule.between(window_start, window_end, inc=True))
        elif window_start <= base_start <= window_end:
            occurrences = [base_start]

        for occ in occurrences:
            end_iso = None
            if base_end is not None:
                duration = base_end - base_start
                end_iso = (occ + duration).isoformat()
            items.append({
                "title": str(comp.get("SUMMARY") or ""),
                "start": occ.isoformat(),
                "end": end_iso,
                "location": str(comp.get("LOCATION") or "") or None,
                "url": str(comp.get("URL") or "") or None,
                "organizer": str(comp.get("ORGANIZER") or "") or None,
            })
    items.sort(key=lambda it: it["start"])
    return items


def fetch_forth_wh_pool() -> FetchResult:
    """Forth Daily Guidance (White House pool). Primary WH source.

    Forth's pool page is a rendered React app; the plain HTTP GET returns
    the pre-hydrated shell with the pool text baked in as JSON in a script
    tag (Next.js `__NEXT_DATA__`) OR as visible paragraphs. We try the
    structured route first and fall back to a text scan. If neither yields
    a plausible pool item, we return ok=false so the compose route can
    fall through to FactBase.
    """
    import json as _json
    import re

    url = "https://www.forth.news/whpool/Cbva3YjK27VrM6642eary"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")

    items: list[dict] = []
    # 1. Try to extract __NEXT_DATA__ if present.
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', r.text, re.DOTALL)
    if m:
        try:
            data = _json.loads(m.group(1))
            # Structure varies; walk any nested list of {time, description}-shaped objects.
            def _walk(node):
                if isinstance(node, dict):
                    if ("time" in node or "start" in node) and ("description" in node or "text" in node or "body" in node):
                        items.append({
                            "time": str(node.get("time") or node.get("start") or ""),
                            "description": str(node.get("description") or node.get("text") or node.get("body") or ""),
                            "pool_status": node.get("pool_status") or node.get("status"),
                        })
                    for v in node.values():
                        _walk(v)
                elif isinstance(node, list):
                    for v in node:
                        _walk(v)
            _walk(data)
        except Exception:
            pass

    # 2. Text-scan fallback for time-prefixed lines ("10:15 AM ET — POTUS ...").
    if not items:
        line_re = re.compile(r'((?:1[0-2]|[1-9]):[0-5][0-9]\s*(?:AM|PM)\s*ET)\s*[—\-:]\s*(.+)', re.IGNORECASE)
        for line in re.split(r"<[^>]+>|\n", r.text):
            line = line.strip()
            if not line:
                continue
            match = line_re.match(line)
            if match:
                items.append({
                    "time": match.group(1).upper(),
                    "description": match.group(2).strip()[:500],
                    "pool_status": None,
                })

    if not items:
        return FetchResult(ok=False, http_status=r.status_code, error="no_items_extracted")
    return FetchResult(ok=True, http_status=r.status_code, payload={"items": items})


def fetch_factbase_wh() -> FetchResult:
    """FactBase — fallback only. See wiki: Forth is preferred.

    FactBase surfaces the daily WH schedule at factba.se/topic/calendar in
    a paginated list. We fetch the JSON that backs the page and normalize.
    Left as a stub with a clean HTTP shell; parse once we've seen a real
    dry-run payload land in daybook_sources.
    """
    url = "https://factba.se/json/json-20170707.php"  # historical endpoint
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    except Exception as e:
        return FetchResult(ok=False, error=f"exception:{e}")
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")
    # We record the raw body so dry runs let us design the parser.
    return FetchResult(
        ok=False,  # deliberately ok=false until parser is written
        http_status=r.status_code,
        payload={"raw_head": r.text[:4000]},
        error="factbase_parser_not_written",
    )


def fetch_congress() -> FetchResult:
    """Congress.gov committee-meeting listing for the target day (or week).

    The v3 API returns a paginated list of `committeeMeetings.item`. Each
    item URL points to a detail resource with title, chamber, committee,
    and meeting date. We list-then-detail with a small concurrency cap.
    """
    from datetime import date, datetime, timedelta

    key = os.environ.get("CONGRESS_API_KEY", "")
    if not key:
        return FetchResult(ok=False, error="missing_CONGRESS_API_KEY")

    pub = date.fromisoformat(PUBLICATION_DATE)
    if EDITION == "weekly":
        start = pub + timedelta(days=1)
        end = start + timedelta(days=6)
    else:
        start = pub
        end = pub

    congress_no = 119 if start >= date(2025, 1, 3) else 118
    list_url = (
        f"https://api.congress.gov/v3/committee-meeting/{congress_no}"
        f"?fromDateTime={start.isoformat()}T00:00:00Z"
        f"&toDateTime={end.isoformat()}T23:59:59Z"
        f"&limit=250&api_key={key}&format=json"
    )
    try:
        r = requests.get(list_url, timeout=TIMEOUT)
    except Exception as e:
        return FetchResult(ok=False, error=f"exception:{e}")
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")
    listing = r.json().get("committeeMeetings", [])

    items: list[dict] = []
    for entry in listing[:50]:  # cap detail fanout
        detail_url = entry.get("url")
        if not detail_url:
            continue
        sep = "&" if "?" in detail_url else "?"
        try:
            d = requests.get(f"{detail_url}{sep}api_key={key}&format=json", timeout=TIMEOUT)
            if not d.ok:
                continue
            m = d.json().get("committeeMeeting", {})
        except Exception:
            continue
        meeting_date = m.get("date") or m.get("meetingDate") or ""
        try:
            when = datetime.fromisoformat(meeting_date.replace("Z", "+00:00"))
        except Exception:
            continue
        committees = m.get("committees", []) or []
        cname = committees[0].get("name") if committees else ""
        chamber = (m.get("chamber") or "").lower()
        items.append({
            "chamber": chamber if chamber in {"house", "senate", "joint"} else "joint",
            "committee": cname or "Unknown Committee",
            "title": m.get("title") or m.get("meetingType") or "Meeting",
            "start": when.isoformat(),
            "room": (m.get("location") or {}).get("room"),
            "url": (m.get("meetingDocuments", [{}])[0] or {}).get("url"),
        })
    items.sort(key=lambda it: it["start"])
    return FetchResult(ok=True, http_status=r.status_code, payload={"items": items})


def fetch_alert_dc() -> FetchResult:
    """AlertDC public feed. The public site does not advertise a JSON feed;
    HSEMA publishes a Twitter/X mirror and an RSS-like feed intermittently.
    Left as an HTTP shell that captures the current landing HTML so we can
    design the parser from real dry-run payloads. Currently non-blocking.
    """
    url = "https://alertdc.dc.gov/"
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=TIMEOUT)
    except Exception as e:
        return FetchResult(ok=False, error=f"exception:{e}")
    if not r.ok:
        return FetchResult(ok=False, http_status=r.status_code, error=f"http_{r.status_code}")
    return FetchResult(
        ok=False,
        http_status=r.status_code,
        payload={"raw_head": r.text[:4000]},
        error="alertdc_parser_not_written",
    )


def fetch_scotus() -> FetchResult:
    """SCOTUS: for Daybook, reuse the last Weekly Planner archive summary
    (per the wiki: 'Daybook Supreme Court context reuses the Weekly Planner
    archive'). We record the archive URL as evidence; parsing lives in the
    compose prompt for now, not this fetcher.
    """
    # Placeholder: return an empty ok=true with a hint. This lets compose
    # skip the section cleanly rather than mark the run failed.
    return FetchResult(
        ok=True,
        payload={"items": [], "source": "weekly_planner_archive_reuse"},
    )


def fetch_mayor() -> FetchResult:
    """Mayor's Office public schedule. The current publication is a
    press-office email list; there is no public JSON. Stub with an ok=true
    empty payload so compose drops the section rather than fails.
    """
    return FetchResult(ok=True, payload={"items": []})


def fetch_dc_council() -> FetchResult:
    """DC Council hearings. The Council's hearings page is server-rendered
    HTML with a list of upcoming items; a full parser is TODO. Non-blocking
    stub: ok=true with empty items.
    """
    return FetchResult(ok=True, payload={"items": []})


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
