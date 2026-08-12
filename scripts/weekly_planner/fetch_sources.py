#!/usr/bin/env python3
"""Data-source fetches for the DC Weekly Planner cron.

Fetches the MIP movement calendar iCal feed for the coming Monday-Sunday
window and returns a structured JSON payload.

Prints a single JSON object to stdout:

    {
      "week_start_iso": "YYYY-MM-DD",   # Monday of the coming week
      "week_end_iso":   "YYYY-MM-DD",   # Sunday of the coming week
      "movement_events": [ ... ] | null,
      "errors": [ "..." ]
    }

Each event dict has:
    { "title", "time", "location", "url", "date" }
where `date` is a YYYY-MM-DD string for grouping in the email.

Usage:
    python3 scripts/weekly_planner/fetch_sources.py > /tmp/planner_sources.json

No env vars required.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    import pytz
except ImportError:
    print(
        json.dumps(
            {
                "week_start_iso": "",
                "week_end_iso": "",
                "movement_events": None,
                "errors": ["pytz not installed"],
            }
        )
    )
    sys.exit(1)


UA = "DCWeeklyPlanner/1.0 patrick@reaxn.io"
HEADERS = {"User-Agent": UA}

EXCLUDE_TITLES = (
    "house in session",
    "senate in session",
    "scotus non-argument session",
    "scotus argument session",
    "lulu's landback",
)


def week_range() -> tuple[Any, Any]:
    """Coming Monday-Sunday, in America/New_York."""
    eastern = pytz.timezone("America/New_York")
    today_et = datetime.now(eastern)
    # If today is Monday, jump to NEXT Monday; else the coming Monday.
    days_until_monday = (7 - today_et.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    monday = (today_et + timedelta(days=days_until_monday)).date()
    sunday = monday + timedelta(days=6)
    return monday, sunday


def fetch_movement_events(monday, sunday) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Returns (events, error). Either is None."""
    try:
        eastern = pytz.timezone("America/New_York")
        req = urllib.request.Request(
            "https://mip-calendar.vercel.app/calendar.ics?overlay=movement",
            headers=HEADERS,
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            ical_text = r.read().decode("utf-8")

        events: list[dict[str, Any]] = []
        for block in re.split(r"BEGIN:VEVENT", ical_text)[1:]:
            def field(name: str) -> str:
                m = re.search(rf"^{name}[^:]*:(.+)$", block, re.MULTILINE)
                return m.group(1).strip() if m else ""

            summary = field("SUMMARY")
            location = field("LOCATION")
            url = field("URL")
            dtstart_raw = field("DTSTART")

            try:
                if "T" in dtstart_raw:
                    ts = dtstart_raw.split(":")[-1]
                    ts_clean = ts if ts.endswith("Z") else re.sub(r"[A-Z]$", "", ts) + "Z"
                    dt_utc = datetime.strptime(ts_clean.rstrip("Z"), "%Y%m%dT%H%M%S").replace(
                        tzinfo=timezone.utc
                    )
                    dt_et = dt_utc.astimezone(eastern)
                    event_date = dt_et.date()
                    time_str = dt_et.strftime("%-I:%M %p")
                else:
                    event_date = datetime.strptime(
                        dtstart_raw.split(":")[-1], "%Y%m%d"
                    ).date()
                    time_str = "All Day"
            except Exception:
                continue

            if not (monday <= event_date <= sunday):
                continue

            if any(ex in summary.lower() for ex in EXCLUDE_TITLES):
                continue

            events.append(
                {
                    "title": summary,
                    "time": time_str,
                    "location": location,
                    "url": url,
                    "date": event_date.isoformat(),
                }
            )

        # Sort: by date, then All Day first within day, then chronologically
        events.sort(key=lambda e: (e["date"], e["time"] != "All Day", e["time"]))
        return events, None
    except Exception as e:  # noqa: BLE001
        return None, f"movement_events: {e}"


def main() -> None:
    monday, sunday = week_range()
    errors: list[str] = []

    events, err = fetch_movement_events(monday, sunday)
    if err:
        errors.append(err)

    print(
        json.dumps(
            {
                "week_start_iso": monday.isoformat(),
                "week_end_iso": sunday.isoformat(),
                "movement_events": events,
                "errors": errors,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
