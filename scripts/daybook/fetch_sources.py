#!/usr/bin/env python3
"""Data-source fetches for the DC Daybook cron.

Runs three fetches that don't need any agent LLM work:

    1. NOAA weather (points + forecast + active alerts for DC)
    2. MIP Calendar movement iCal feed (today's events only)
    3. AlertDC HSEMA RSS/HTML feed (today's non-crime alerts)

Prints a single JSON object to stdout with these keys:

    {
      "date_iso": "YYYY-MM-DD",
      "weekday_short": "Mon" | "Tue" | ... ,
      "is_friday": bool,
      "weather": { ... } | null,
      "movement_events": [ ... ] | null,
      "alertdc": [ ... ] | null,
      "errors": [ "human-readable error strings" ]
    }

Errors per source are captured in `errors` but never crash the run — the
cron falls back to placeholder text when a source is null.

The Daybook agent task uses this as a preflight step so the prompt-embedded
Python is much smaller, easier to test, and gets version-controlled diffs.

Usage:
    python3 scripts/daybook/fetch_sources.py > /tmp/daybook_sources.json

No env vars required. Standard-library only (urllib + json + re + datetime + pytz).
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

try:
    import pytz
except ImportError:
    print(
        json.dumps(
            {
                "date_iso": "",
                "weekday_short": "",
                "is_friday": False,
                "weather": None,
                "movement_events": None,
                "alertdc": None,
                "errors": ["pytz not installed"],
            }
        )
    )
    sys.exit(1)


UA = "DCDaybook/1.0 patrick@reaxn.io"
HEADERS = {"User-Agent": UA}


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------

# NOAA shortForecast -> emoji lookup. Order matters: more specific first.
_WEATHER_EMOJI = (
    ("thunderstorm", "⛈"),
    ("showers", "🌧"),
    ("rain", "🌧"),
    ("snow", "🌨"),
    ("sleet", "🌨"),
    ("flurries", "🌨"),
    ("fog", "🌫"),
    ("haze", "🌫"),
    ("windy", "💨"),
    ("breezy", "💨"),
    ("partly sunny", "⛅"),
    ("partly cloudy", "⛅"),
    ("mostly cloudy", "🌥"),
    ("cloudy", "🌥"),
    ("overcast", "🌥"),
    ("sunny", "☀️"),
    ("clear", "☀️"),
)


def weather_emoji(short_forecast: str) -> str:
    s = (short_forecast or "").lower()
    for needle, emoji in _WEATHER_EMOJI:
        if needle in s:
            return emoji
    return "🌡️"


def fetch_weather() -> tuple[dict[str, Any] | None, str | None]:
    """Returns (weather_dict, error_string). Either is None."""
    try:
        # 1. Gridpoint discovery for downtown DC (38.9072, -77.0369)
        req = urllib.request.Request(
            "https://api.weather.gov/points/38.9072,-77.0369",
            headers=HEADERS,
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            pts = json.loads(r.read())
        forecast_url = pts["properties"]["forecast"]

        # 2. Forecast periods
        req2 = urllib.request.Request(forecast_url, headers=HEADERS)
        with urllib.request.urlopen(req2, timeout=10) as r:
            fdata = json.loads(r.read())
        periods = fdata["properties"]["periods"]

        # 3. Active alerts for DC
        req3 = urllib.request.Request(
            "https://api.weather.gov/alerts/active?area=DC",
            headers=HEADERS,
        )
        with urllib.request.urlopen(req3, timeout=10) as r:
            adata = json.loads(r.read())
        alerts = adata.get("features") or []

        def slim(p: dict[str, Any]) -> dict[str, Any]:
            return {
                "name": p.get("name"),
                "is_daytime": p.get("isDaytime"),
                "temperature": p.get("temperature"),
                "temperature_unit": p.get("temperatureUnit"),
                "wind_speed": p.get("windSpeed"),
                "wind_direction": p.get("windDirection"),
                "short_forecast": p.get("shortForecast"),
                "detailed_forecast": p.get("detailedForecast"),
                "probability_of_precipitation": (
                    (p.get("probabilityOfPrecipitation") or {}).get("value")
                ),
                "emoji": weather_emoji(p.get("shortForecast") or ""),
            }

        return (
            {
                "today": slim(periods[0]) if len(periods) > 0 else None,
                "tonight": slim(periods[1]) if len(periods) > 1 else None,
                "day2": slim(periods[2]) if len(periods) > 2 else None,
                "day3": slim(periods[4]) if len(periods) > 4 else None,
                "alerts": [
                    {
                        "event": (a.get("properties") or {}).get("event"),
                        "headline": (a.get("properties") or {}).get("headline"),
                        "severity": (a.get("properties") or {}).get("severity"),
                    }
                    for a in alerts
                ],
            },
            None,
        )
    except Exception as e:  # noqa: BLE001
        return None, f"weather: {e}"


# ---------------------------------------------------------------------------
# MIP movement iCal feed
# ---------------------------------------------------------------------------

EXCLUDE_TITLES = (
    "house in session",
    "senate in session",
    "scotus non-argument session",
    "scotus argument session",
    "lulu's landback",
)


def fetch_movement_events(today_et_date) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Returns (events_list, error_string). Either is None."""
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

            if event_date != today_et_date:
                continue

            if any(ex in summary.lower() for ex in EXCLUDE_TITLES):
                continue

            events.append(
                {
                    "title": summary,
                    "time": time_str,
                    "location": location,
                    "url": url,
                }
            )

        # Sort: All Day first, then chronologically
        events.sort(key=lambda e: (e["time"] != "All Day", e["time"]))
        return events, None
    except Exception as e:  # noqa: BLE001
        return None, f"movement_events: {e}"


# ---------------------------------------------------------------------------
# AlertDC (HSEMA)
# ---------------------------------------------------------------------------


def fetch_alertdc(today_et_date) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Returns (alerts_list, error_string). Either is None.

    Skips any alert whose title contains 'crime alert' (Patrick's rule).
    """
    try:
        req = urllib.request.Request(
            "https://trainingtrack.hsema.dc.gov/NRss/RssFeed/AlertDCList",
            headers=HEADERS,
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            html = r.read().decode("utf-8", errors="replace")

        # Match today's date as M/D/YYYY (no leading zeros).
        today_str = f"{today_et_date.month}/{today_et_date.day}/{today_et_date.year}"

        # Rough parse: each alert row shows up with a title <a href=...>Title</a>
        # near a timestamp and a description. This is intentionally forgiving
        # since HSEMA's markup changes occasionally.
        alerts: list[dict[str, Any]] = []
        # Find timestamp-anchored rows for today
        for m in re.finditer(
            r"(\d{1,2}/\d{1,2}/\d{4}[^<]*?)<[^>]*?>.*?<a[^>]*href=\"([^\"]+)\"[^>]*>([^<]+)</a>[^<]*?<[^>]*?>([^<]{0,600})",
            html,
            flags=re.DOTALL,
        ):
            timestamp = m.group(1).strip()
            if today_str not in timestamp:
                continue
            href = m.group(2).strip()
            title = m.group(3).strip()
            description = re.sub(r"\s+", " ", m.group(4).strip())

            if "crime alert" in title.lower():
                continue

            if href.startswith("/"):
                href = "https://trainingtrack.hsema.dc.gov" + href

            alerts.append(
                {
                    "timestamp": timestamp,
                    "title": title,
                    "description": description[:400],
                    "url": href,
                }
            )

        return alerts, None
    except Exception as e:  # noqa: BLE001
        return None, f"alertdc: {e}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    eastern = pytz.timezone("America/New_York")
    today_et = datetime.now(eastern)
    today_date = today_et.date()
    weekday_short = today_et.strftime("%a")  # Mon/Tue/Wed/Thu/Fri/Sat/Sun
    is_friday = today_et.weekday() == 4

    errors: list[str] = []

    weather, err = fetch_weather()
    if err:
        errors.append(err)

    events, err = fetch_movement_events(today_date)
    if err:
        errors.append(err)

    alerts, err = fetch_alertdc(today_date)
    if err:
        errors.append(err)

    print(
        json.dumps(
            {
                "date_iso": today_date.isoformat(),
                "weekday_short": weekday_short,
                "is_friday": is_friday,
                "weather": weather,
                "movement_events": events,
                "alertdc": alerts,
                "errors": errors,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
