#!/usr/bin/env python3
"""Sanity tests for parse_the_51st.

Run: python ingest/test_parse_the_51st.py

Fixture ingest/fixtures/the_51st_rss.xml is a trimmed copy of the live
Civics Roundup feed (2026-09-25) with two posts: the Sep 22 roundup (current
layout) and the Jul 30 roundup (older layout with <br> nested in <strong>).
"""

import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from parse_the_51st import _clean_url, parse_the_51st, parse_time_line  # noqa: E402


def _run_dir() -> Path:
    tmp = Path(tempfile.mkdtemp())
    shutil.copy(HERE / "fixtures" / "the_51st_rss.xml", tmp / "raw_the_51st.xml")
    return tmp


def test_time_lines() -> None:
    cases = {
        "6 - 8 p.m.": ("6:00 PM", "8:00 PM"),
        "6:30 - 8:30 p.m.": ("6:30 PM", "8:30 PM"),
        "7 p.m.": ("7:00 PM", ""),
        "12 - 2 p.m.": ("12:00 PM", "2:00 PM"),
        "2 - 4:30 p.m.": ("2:00 PM", "4:30 PM"),
        "10 - 1 p.m.": ("10:00 AM", "1:00 PM"),
        "11 a.m. - 2 p.m.": ("11:00 AM", "2:00 PM"),
        "noon - 3 p.m.": ("12:00 PM", "3:00 PM"),
        "7:45 a.m.": ("7:45 AM", ""),
        "Doors 5 p.m., show 5:30 p.m.": ("5:00 PM", ""),
        # Must not read "July 1 - 2" as 1-2 p.m.
        "Starts at 5 p.m.; July 1 - 2": ("5:00 PM", ""),
        "Meet at 10:30 a.m.; hike begins at 11 a.m.": ("10:30 AM", ""),
        "All day": ("", ""),
    }
    for raw, want in cases.items():
        got = parse_time_line(raw)
        assert got == want, f"{raw!r}: got {got}, want {want}"


def test_clean_url() -> None:
    assert _clean_url("https://x.org/e?ref=51st.news") == "https://x.org/e"
    assert (
        _clean_url("https://m.us/e/1/?link_id=18&can_id=abc&source=email-blast&utm_medium=x&keep=1")
        == "https://m.us/e/1/?keep=1"
    )


def test_current_post() -> None:
    evs = parse_the_51st(_run_dir(), today=date(2026, 9, 22))
    sep = [e for e in evs if "september-22" in e["event_url"]]
    assert len(sep) == 14, len(sep)
    assert all(e["source"] == "The 51st" for e in sep)

    by_title = {e["title"]: e for e in sep}
    fest = by_title["D.C. Community Organizing Festival"]
    assert (fest["date"], fest["time"], fest["end_time"]) == ("9/26/2026", "12:00 PM", "4:00 PM")
    assert "ref=" not in fest["rsvp_link"]
    assert fest["description"].endswith(
        "Via The 51st Civics Roundup: https://51st.news/how-to-volunteer-washington-dc-get-involved-september-22/"
    )

    # Hybrid location gets tagged so normalize.ts' guessLocationType sees it.
    assert by_title["Controlling the Story: Media Literacy Training"]["location"].startswith("Hybrid: Virtual or")

    # Editorial slip in the source: H Street Unity Day reuses Cop Watch's RSVP.
    assert by_title["Cop Watch training"]["rsvp_link"].startswith("https://www.mobilize.us/hwd/event/1022577/")
    assert by_title["H Street Unity Day"]["rsvp_link"] == ""

    # event_url must be unique per listing (submissions route dedup key).
    assert len({e["event_url"] for e in sep}) == len(sep)

    # Resource table at the bottom must not leak in.
    assert not any("Council" in e["title"] and not e["time"] for e in sep)


def test_past_events_dropped() -> None:
    evs = parse_the_51st(_run_dir(), today=date(2026, 9, 26))
    dates = {e["date"] for e in evs}
    assert dates <= {"9/26/2026", "9/27/2026"}, dates
    # Jul 30 post is older than the 10-day window.
    assert not any("july-30" in e["event_url"] for e in evs)


def test_older_layout() -> None:
    # Pretend it's Aug 1 so the Jul 30 post is in-window.
    evs = parse_the_51st(_run_dir(), today=date(2026, 8, 1))
    jul = [e for e in evs if "july-30" in e["event_url"]]
    wc = next(e for e in jul if e["title"] == "August Workers Circle")
    assert (wc["date"], wc["time"], wc["end_time"]) == ("8/3/2026", "6:30 PM", "8:00 PM")
    assert wc["location"] == "The Festival Center (1640 Columbia Rd. NW)"
    assert wc["rsvp_link"] == "https://actionnetwork.org/events/august-workers-circle-2"
    assert "(sign up to bring something here)" in wc["description"]


def test_missing_file() -> None:
    assert parse_the_51st(Path(tempfile.mkdtemp())) == []


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all parse_the_51st tests passed")
