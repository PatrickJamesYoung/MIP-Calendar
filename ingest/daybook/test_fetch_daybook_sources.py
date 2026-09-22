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


# --- WH ICS parser (Factba.se schedule) tests -------------------------------


from fetch_daybook_sources import _parse_wh_ics  # noqa: E402


def test_wh_parser_extracts_time_description_and_pool_status():
    ics = _ics(
        _vevent(
            DTSTART="20260922T140000Z",  # 10:00 AM EDT
            SUMMARY="The President delivers Remarks",
            DESCRIPTION="Pre-Credentialed Media",
        )
    )
    items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert len(items) == 1
    assert items[0]["time"] == "10:00 AM ET"
    assert items[0]["description"] == "The President delivers Remarks"
    assert items[0]["pool_status"] == "Pre-Credentialed Media"


def test_wh_parser_omits_pool_status_when_description_absent():
    ics = _ics(
        _vevent(
            DTSTART="20260922T140000Z",
            SUMMARY="The President arrives at United Nations",
            LOCATION="United Nations Headquarters, New York",
        )
    )
    items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert len(items) == 1
    assert "pool_status" not in items[0]


def test_wh_parser_filters_out_of_window_events():
    ics = _ics(
        _vevent(
            DTSTART="20260921T140000Z",  # yesterday
            SUMMARY="Should be excluded",
        ),
        _vevent(
            DTSTART="20260922T140000Z",
            SUMMARY="Today's event",
        ),
    )
    items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert len(items) == 1
    assert items[0]["description"] == "Today's event"


def test_wh_parser_sorts_by_time():
    ics = _ics(
        _vevent(DTSTART="20260922T230000Z", SUMMARY="Evening remarks"),  # 7:00 PM ET
        _vevent(DTSTART="20260922T140000Z", SUMMARY="Morning remarks"),  # 10:00 AM ET
    )
    items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert [i["description"] for i in items] == ["Morning remarks", "Evening remarks"]


def test_wh_parser_recognizes_all_pool_phrases():
    phrases = [
        "Out-of-Town Travel Pool",
        "In-Town Pool",
        "Open Press",
        "Closed Press",
    ]
    for i, phrase in enumerate(phrases):
        # Space events out across the day to avoid identical timestamps.
        hour = 14 + i
        ics = _ics(
            _vevent(
                DTSTART=f"20260922T{hour:02d}0000Z",
                SUMMARY=f"Event {i}",
                DESCRIPTION=phrase,
            )
        )
        items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
        assert items[0]["pool_status"] == phrase, phrase


def test_wh_parser_sorts_am_before_pm_chronologically():
    """Regression: '10:40 AM' must sort before '12:00 AM' even though the
    strings compare wrong lexically."""
    ics = _ics(
        _vevent(DTSTART="20260922T160000Z", SUMMARY="Noon UTC event"),   # 12:00 PM ET
        _vevent(DTSTART="20260922T144000Z", SUMMARY="10:40 AM ET event"),  # 10:40 AM ET
        _vevent(DTSTART="20260923T035959Z", SUMMARY="Late night ET event"),  # 11:59 PM ET
    )
    items = _parse_wh_ics(ics, publication_date="2026-09-22", edition="daybook")
    assert [i["description"] for i in items] == [
        "10:40 AM ET event",
        "Noon UTC event",
        "Late night ET event",
    ]
