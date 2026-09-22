"""Tests for the daybook ICS parser.

Run with `pytest ingest/daybook/test_fetch_daybook_sources.py`.
Env vars are set before import so module-level os.environ[...] reads succeed.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("RUN_ID", "00000000-0000-0000-0000-000000000000")
os.environ.setdefault("INGEST_API_BASE", "https://example.invalid")
os.environ.setdefault("DAYBOOK_BEARER_TOKEN", "test-token")
os.environ.setdefault("PUBLICATION_DATE", "2026-09-22")
os.environ.setdefault("EDITION", "daybook")

sys.path.insert(0, str(Path(__file__).parent))
from fetch_daybook_sources import _parse_ics, _window_et  # noqa: E402


def _ics(*vevents: str) -> str:
    body = "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//test//test//EN",
            *vevents,
            "END:VCALENDAR",
            "",
        ]
    )
    return body


def _vevent(**fields: str) -> str:
    lines = ["BEGIN:VEVENT"]
    for k, v in fields.items():
        lines.append(f"{k}:{v}")
    lines.append("END:VEVENT")
    return "\r\n".join(lines)


def test_window_daybook_covers_single_day_in_et():
    start, end = _window_et("2026-09-22", "daybook")
    # 2026-09-22 midnight EDT = 04:00 UTC same day
    assert start.isoformat() == "2026-09-22T04:00:00+00:00"
    assert end.isoformat() == "2026-09-23T04:00:00+00:00"


def test_window_weekly_covers_seven_days():
    start, end = _window_et("2026-09-22", "weekly")
    assert (end - start).days == 7


def test_parses_utc_event_inside_window():
    ics = _ics(
        _vevent(
            UID="e1@test",
            SUMMARY="Rally at Franklin Square",
            DTSTART="20260922T170000Z",  # 1pm ET
            DTEND="20260922T190000Z",
            LOCATION="Franklin Square",
            URL="https://example.org/rally",
        )
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert len(items) == 1
    it = items[0]
    assert it["title"] == "Rally at Franklin Square"
    assert it["start"] == "2026-09-22T13:00:00-04:00"
    assert it["end"] == "2026-09-22T15:00:00-04:00"
    assert it["location"] == "Franklin Square"
    assert it["url"] == "https://example.org/rally"


def test_filters_out_events_outside_the_window():
    ics = _ics(
        _vevent(UID="a@test", SUMMARY="Yesterday", DTSTART="20260921T170000Z"),
        _vevent(UID="b@test", SUMMARY="Today", DTSTART="20260922T170000Z"),
        _vevent(UID="c@test", SUMMARY="Tomorrow", DTSTART="20260923T170000Z"),
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert [it["title"] for it in items] == ["Today"]


def test_weekly_edition_expands_to_seven_days():
    ics = _ics(
        _vevent(UID="a@test", SUMMARY="Day 1", DTSTART="20260922T170000Z"),
        _vevent(UID="b@test", SUMMARY="Day 5", DTSTART="20260926T170000Z"),
        _vevent(UID="c@test", SUMMARY="Day 8", DTSTART="20260929T170000Z"),
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="weekly")
    assert [it["title"] for it in items] == ["Day 1", "Day 5"]


def test_items_are_sorted_by_start():
    ics = _ics(
        _vevent(UID="b@test", SUMMARY="Later", DTSTART="20260922T210000Z"),
        _vevent(UID="a@test", SUMMARY="Earlier", DTSTART="20260922T130000Z"),
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert [it["title"] for it in items] == ["Earlier", "Later"]


def test_empty_summary_events_are_dropped():
    ics = _ics(
        _vevent(UID="a@test", SUMMARY="", DTSTART="20260922T170000Z"),
        _vevent(UID="b@test", SUMMARY="Good one", DTSTART="20260922T170000Z"),
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert len(items) == 1


def test_rrule_events_raise_not_implemented():
    ics = _ics(
        _vevent(
            UID="r@test",
            SUMMARY="Weekly standup",
            DTSTART="20260922T170000Z",
            RRULE="FREQ=WEEKLY;COUNT=4",
        )
    )
    import pytest

    with pytest.raises(NotImplementedError):
        _parse_ics(ics, publication_date="2026-09-22", edition="daybook")


def test_mailto_prefix_stripped_from_organizer():
    ics = _ics(
        _vevent(
            UID="o@test",
            SUMMARY="Test",
            DTSTART="20260922T170000Z",
            ORGANIZER="MAILTO:x@example.org",
        )
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert items[0]["organizer"] == "x@example.org"


def test_non_http_urls_are_dropped():
    ics = _ics(
        _vevent(
            UID="u@test",
            SUMMARY="Test",
            DTSTART="20260922T170000Z",
            URL="javascript:alert(1)",
        )
    )
    items = _parse_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert "url" not in items[0]
