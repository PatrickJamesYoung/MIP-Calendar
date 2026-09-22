"""Unit tests for the pure-logic pieces of fetch_daybook_sources.

Runs under vitest? No — pytest. Kept alongside the module. The CI workflow
should add `pytest ingest/daybook/` before enabling live sends.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the module importable without executing __main__ side-effects.
os.environ.setdefault("RUN_ID", "00000000-0000-0000-0000-000000000000")
os.environ.setdefault("INGEST_API_BASE", "http://localhost")
os.environ.setdefault("DAYBOOK_BEARER_TOKEN", "test")
os.environ.setdefault("EDITION", "daybook")
os.environ.setdefault("PUBLICATION_DATE", "2026-09-22")

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from ingest.daybook.fetch_daybook_sources import _parse_ics  # noqa: E402


SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:evt-1@example.com
DTSTART;TZID=America/New_York:20260922T170000
DTEND;TZID=America/New_York:20260922T190000
SUMMARY:Housing rally
LOCATION:Freedom Plaza
URL:https://example.com/rally
END:VEVENT
BEGIN:VEVENT
UID:evt-2@example.com
DTSTART;TZID=America/New_York:20260924T180000
SUMMARY:Later this week
END:VEVENT
BEGIN:VEVENT
UID:evt-3@example.com
DTSTART;TZID=America/New_York:20260901T090000
RRULE:FREQ=WEEKLY;BYDAY=TU
SUMMARY:Weekly Tuesday standup
END:VEVENT
END:VCALENDAR
"""


def test_parse_ics_daybook_window():
    items = _parse_ics(SAMPLE_ICS, publication_date="2026-09-22", edition="daybook")
    titles = [it["title"] for it in items]
    # Housing rally + the weekly Tuesday standup expansion for 2026-09-22.
    assert "Housing rally" in titles
    assert "Weekly Tuesday standup" in titles
    assert "Later this week" not in titles


def test_parse_ics_weekly_window():
    # Publication 2026-09-21 (Sunday) → covers Mon 09-22 through Sun 09-28.
    items = _parse_ics(SAMPLE_ICS, publication_date="2026-09-21", edition="weekly")
    titles = [it["title"] for it in items]
    assert "Housing rally" in titles
    assert "Later this week" in titles


def test_parse_ics_extracts_location_and_url():
    items = _parse_ics(SAMPLE_ICS, publication_date="2026-09-22", edition="daybook")
    housing = next(it for it in items if it["title"] == "Housing rally")
    assert housing["location"] == "Freedom Plaza"
    assert housing["url"] == "https://example.com/rally"
    assert housing["start"].startswith("2026-09-22T17:00:00")


def test_parse_ics_sorts_by_start():
    items = _parse_ics(SAMPLE_ICS, publication_date="2026-09-21", edition="weekly")
    starts = [it["start"] for it in items]
    assert starts == sorted(starts)
