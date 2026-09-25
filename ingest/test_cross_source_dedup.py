#!/usr/bin/env python3
"""Quick sanity test for cross_source_dedup.

Run: python ingest/test_cross_source_dedup.py
"""

import json
import os
import tempfile
from pathlib import Path


def run() -> None:
    tmp = Path(tempfile.mkdtemp())
    os.environ["RUN_DIR"] = str(tmp)

    # Force reimport with the new RUN_DIR.
    import importlib
    import sys as _sys

    _sys.path.insert(0, str(Path(__file__).parent))
    if "cross_source_dedup" in _sys.modules:
        del _sys.modules["cross_source_dedup"]
    csd = importlib.import_module("cross_source_dedup")

    events = [
        # 1. Exact intra-run dup: Grassroots + Free DC both list a rally.
        {
            "source": "Free DC",
            "title": "Free DC Freedom Dreaming Session 1",
            "date": "8/9/2026",
            "time": "6:00 PM",
        },
        {
            "source": "Grassroots DC",
            "title": "Freedom Dreaming Session 1",
            "date": "8/9/2026",
            "time": "6:00 PM",
        },
        # 2. Fuzzy dup with slight rewording, cross-source.
        {
            "source": "Rhizome DC",
            "title": "Open Mic Night at Rhizome",
            "date": "8/10/2026",
            "time": "8:00 PM",
        },
        {
            "source": "Grassroots DC",
            "title": "Open Mic Night — Rhizome DC",
            "date": "8/10/2026",
            "time": "8:00 PM",
        },
        # 3. Fuzzy match, ±1 day adjacent — should still collapse.
        {
            "source": "Mobilize",
            "title": "Union Rally at Freedom Plaza",
            "date": "8/12/2026",
        },
        {
            "source": "Grassroots DC",
            "title": "Union Rally at Freedom Plaza",
            "date": "8/13/2026",
        },
        # 4. Legit separate events at same venue same day — should NOT collapse.
        {
            "source": "Busboys & Poets",
            "title": "Poetry Slam",
            "date": "8/14/2026",
        },
        {
            "source": "Busboys & Poets",
            "title": "Author Talk with Ta-Nehisi Coates",
            "date": "8/14/2026",
        },
        # 5. Same source dup — leave alone (runner's job).
        {
            "source": "Grassroots DC",
            "title": "Rent Control Meeting",
            "date": "8/15/2026",
        },
        {
            "source": "Grassroots DC",
            "title": "Rent Control Meeting",
            "date": "8/15/2026",
        },
        # 6. Unique event on unique day.
        {
            "source": "Festival Center",
            "title": "Community Potluck",
            "date": "8/20/2026",
        },
        # 7. The 51st vs the originating org in the same run — org wins.
        {
            "source": "Free DC",
            "title": "Chocolate City Free DC orientation",
            "date": "9/23/2026",
        },
        {
            "source": "The 51st",
            "title": "Chocolate City Free DC orientation",
            "date": "9/23/2026",
        },
        # 8. The 51st listing already on the calendar — dropped outright.
        {
            "source": "The 51st",
            "title": "Ward 7 freedom dreaming session",
            "date": "9/24/2026",
            "movement_calendar": "Posted",
        },
        # 9. Non-aggregator 'Posted' rows are left alone (unchanged behavior).
        {
            "source": "Mobilize",
            "title": "Tenant Know Your Rights",
            "date": "9/24/2026",
            "movement_calendar": "Posted",
        },
        # 10. Fresh The 51st listing — kept.
        {
            "source": "The 51st",
            "title": "D.C. Community Organizing Festival",
            "date": "9/26/2026",
        },
    ]

    (tmp / "new_events.json").write_text(json.dumps(events))

    rc = csd.main()
    assert rc == 0

    out = json.loads((tmp / "new_events.json").read_text())
    report = json.loads((tmp / "dedup_report.json").read_text())

    print(f"\n=== TEST RESULT ===")
    print(f"in: {len(events)}, out: {len(out)}, collapsed: {report['collapsed']}")
    print(f"\nKept:")
    for e in out:
        print(f"  {e['source']:16s} · {e['title']} · {e['date']}")
    print(f"\nDropped:")
    for r in report["entries"]:
        print(
            f"  [{r['match_type']}] kept {r['kept']['source']!r} · dropped {r['dropped']['source']!r} · {r['dropped']['title']}"
        )

    # Assertions.
    kept_titles = [(e["source"], e["title"]) for e in out]

    # #1 — Grassroots dropped, Free DC kept.
    assert ("Free DC", "Free DC Freedom Dreaming Session 1") in kept_titles, "Free DC should win over Grassroots"
    assert not any(e["source"] == "Grassroots DC" and "Freedom Dreaming" in e["title"] for e in out), (
        "Grassroots Freedom Dreaming should be dropped"
    )

    # #2 — Rhizome kept, Grassroots dropped.
    assert any(e["source"] == "Rhizome DC" for e in out), "Rhizome should win"
    assert not any(e["source"] == "Grassroots DC" and "Open Mic" in e["title"] for e in out), (
        "Grassroots Open Mic should be dropped"
    )

    # #3 — Mobilize kept, Grassroots dropped (adjacent day).
    assert any(e["source"] == "Mobilize" for e in out), "Mobilize should win on adjacent-day fuzzy"
    assert not any(e["source"] == "Grassroots DC" and "Union Rally" in e["title"] for e in out), (
        "Grassroots Union Rally should be dropped"
    )

    # #4 — Both Busboys events should remain (different events, same venue/day).
    busboys_titles = [e["title"] for e in out if e["source"] == "Busboys & Poets"]
    assert len(busboys_titles) == 2, f"Both Busboys events should stay, got {busboys_titles}"

    # #5 — Same-source dupes: at least one remains (we don't dedupe within source).
    grassroots_rent = [e for e in out if e["source"] == "Grassroots DC" and "Rent Control" in e["title"]]
    assert len(grassroots_rent) >= 1

    # #6 — Unique event kept.
    assert any(e["title"] == "Community Potluck" for e in out)

    # #7 — Free DC beats The 51st.
    assert ("Free DC", "Chocolate City Free DC orientation") in kept_titles
    assert ("The 51st", "Chocolate City Free DC orientation") not in kept_titles

    # #8 — already-posted aggregator row dropped, and reported.
    assert not any("Ward 7 freedom" in e["title"] for e in out)
    assert any(r["match_type"] == "already_posted" for r in report["entries"])

    # #9 — non-aggregator Posted row untouched.
    assert ("Mobilize", "Tenant Know Your Rights") in kept_titles

    # #10 — fresh The 51st row kept.
    assert ("The 51st", "D.C. Community Organizing Festival") in kept_titles

    print("\n✅ ALL ASSERTIONS PASSED")


if __name__ == "__main__":
    run()
