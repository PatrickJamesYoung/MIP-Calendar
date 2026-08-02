#!/usr/bin/env python3
"""Intra-run cross-source deduplication.

runner.py dedupes each incoming event against the calendar's DB by an
exact (source, title, date) match. That works for "same event we've already
published", but it does NOT catch **intra-run** duplicates: when Grassroots
DC aggregates from Free DC / Rhizome / Mobilize etc., the same event can
appear under two different runner sources in a single run, and both slip
into the submissions queue.

This step runs AFTER runner.py and BEFORE post_submissions.py. It reads
new_events.json, collapses cross-source duplicates using a normalized
(title, date) key with a fuzzy fallback, and rewrites new_events.json with
the losers removed. It also writes dedup_report.json with a per-collapse
audit trail that the run email surfaces.

Rules
-----
* Same (normalized_title, date) → exact dup.
* Otherwise, fuzzy: same date (±1 day), SequenceMatcher ratio ≥ 0.75 on
  normalized titles (with Free DC prefix stripped for comparison).
* Original source wins over the aggregator. Grassroots DC is an aggregator
  and is only kept when no other source has the event. Every other source
  is treated as an "original" and ranked by our curation priority.

The runner is NOT modified; this is a strictly-later pass.
"""

from __future__ import annotations

import json
import os
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


RUN_DIR = Path(os.environ.get("RUN_DIR", "."))

NEW_EVENTS = RUN_DIR / "new_events.json"
REPORT = RUN_DIR / "dedup_report.json"

# Fuzzy match threshold — user chose "Aggressive (0.75)" on 2026-08-02.
# See conversation with Patrick for the rationale.
FUZZY_THRESHOLD = 0.75

# Priority order — lower index wins. Grassroots DC is deliberately last of
# the "curated" sources because it aggregates from the others.
SOURCE_PRIORITY: dict[str, int] = {
    "Free DC": 0,
    "Rhizome DC": 1,
    "Mobilize": 2,
    "Festival Center": 3,
    "Metro DC DSA": 4,
    "PopVille": 5,
    "Busboys & Poets": 6,
    "Grassroots DC": 7,
}


def _normalize_title(t: str) -> str:
    if not t:
        return ""
    s = t.lower().strip()
    # Strip the Free DC prefix so both sides compare on the underlying title.
    s = re.sub(r"^free dc\s+", "", s)
    # Drop common noise: emoji, bracketed suffixes, extra punctuation.
    s = re.sub(r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF]", "", s)
    s = re.sub(r"\s*[\(\[][^)\]]*[\)\]]\s*$", "", s)  # trailing (…) or […]
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _date_key(date_str: str) -> str:
    """Runner emits dates as M/D/YYYY. Normalize for exact bucketing."""
    if not date_str:
        return ""
    try:
        m, d, y = date_str.strip().split("/")
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except Exception:
        return date_str.strip()


def _priority(source: str) -> int:
    return SOURCE_PRIORITY.get(source, 99)


def _fields_filled(ev: dict[str, Any]) -> int:
    """Tiebreaker: pick the richer record when priorities are equal."""
    keys = ("description", "location", "host", "url", "time", "end_time")
    return sum(1 for k in keys if (ev.get(k) or "").strip())


def _better(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Return whichever event should win when a and b are duplicates."""
    pa, pb = _priority(a["source"]), _priority(b["source"])
    if pa != pb:
        return a if pa < pb else b
    fa, fb = _fields_filled(a), _fields_filled(b)
    if fa != fb:
        return a if fa > fb else b
    # Stable last-resort: keep the first one we saw.
    return a


def dedupe(events: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (kept, report). report is a list of {winner, loser} dicts.

    Two-pass: exact (norm_title, date) buckets first, then a fuzzy pass
    over the survivors keyed on date (±1 day).
    """
    report: list[dict[str, Any]] = []

    # ---- pass 1: exact bucketing on (norm_title, date) ---------------------
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    for ev in events:
        key = (_normalize_title(ev.get("title", "")), _date_key(ev.get("date", "")))
        if not key[0] or not key[1]:
            # Un-keyable event — pass it through; runner already vetted it.
            # We stash it in the bucket under a unique fallback key.
            buckets[(f"__nokey_{id(ev)}", "")] = ev
            continue
        existing = buckets.get(key)
        if existing is None:
            buckets[key] = ev
        else:
            winner = _better(existing, ev)
            loser = ev if winner is existing else existing
            buckets[key] = winner
            report.append(
                {
                    "match_type": "exact",
                    "kept": {
                        "source": winner["source"],
                        "title": winner.get("title"),
                        "date": winner.get("date"),
                    },
                    "dropped": {
                        "source": loser["source"],
                        "title": loser.get("title"),
                        "date": loser.get("date"),
                    },
                }
            )

    survivors = list(buckets.values())

    # ---- pass 2: fuzzy match on same/adjacent date ------------------------
    # Group by date_key so we only compare within a small window.
    from collections import defaultdict

    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ev in survivors:
        by_date[_date_key(ev.get("date", ""))].append(ev)

    # Iterate over dates in order for stable output.
    dropped_ids: set[int] = set()

    def _neighboring_dates(dk: str) -> list[str]:
        if not dk:
            return []
        try:
            y, m, d = dk.split("-")
            from datetime import date, timedelta

            base = date(int(y), int(m), int(d))
            return [(base + timedelta(days=off)).isoformat() for off in (-1, 0, 1)]
        except Exception:
            return [dk]

    seen_pairs: set[tuple[int, int]] = set()
    for dk in sorted(by_date.keys()):
        candidate_pool: list[dict[str, Any]] = []
        for nd in _neighboring_dates(dk):
            candidate_pool.extend(by_date.get(nd, []))
        # Dedup pool by id() to avoid comparing an event to itself twice.
        pool_by_id: dict[int, dict[str, Any]] = {id(e): e for e in candidate_pool}
        pool = list(pool_by_id.values())
        for i in range(len(pool)):
            a = pool[i]
            if id(a) in dropped_ids:
                continue
            for j in range(i + 1, len(pool)):
                b = pool[j]
                if id(b) in dropped_ids:
                    continue
                pair = (min(id(a), id(b)), max(id(a), id(b)))
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                if a["source"] == b["source"]:
                    continue  # same source dupes are runner's problem
                ta = _normalize_title(a.get("title", ""))
                tb = _normalize_title(b.get("title", ""))
                if not ta or not tb:
                    continue
                ratio = SequenceMatcher(None, ta, tb).ratio()
                if ratio < FUZZY_THRESHOLD:
                    continue
                winner = _better(a, b)
                loser = b if winner is a else a
                dropped_ids.add(id(loser))
                report.append(
                    {
                        "match_type": "fuzzy",
                        "ratio": round(ratio, 3),
                        "kept": {
                            "source": winner["source"],
                            "title": winner.get("title"),
                            "date": winner.get("date"),
                        },
                        "dropped": {
                            "source": loser["source"],
                            "title": loser.get("title"),
                            "date": loser.get("date"),
                        },
                    }
                )

    kept = [e for e in survivors if id(e) not in dropped_ids]
    return kept, report


def main() -> int:
    if not NEW_EVENTS.exists():
        print("[xdedup] no new_events.json — skipping")
        return 0

    events = json.loads(NEW_EVENTS.read_text())
    if not events:
        REPORT.write_text(json.dumps({"collapsed": 0, "entries": []}, indent=1))
        print("[xdedup] 0 events in — nothing to do")
        return 0

    kept, report = dedupe(events)
    collapsed = len(events) - len(kept)

    NEW_EVENTS.write_text(json.dumps(kept, indent=1))
    REPORT.write_text(
        json.dumps({"collapsed": collapsed, "entries": report}, indent=1)
    )

    print(f"[xdedup] {len(events)} in → {len(kept)} out ({collapsed} collapsed)")
    for r in report:
        mt = r.get("match_type")
        ratio = f" r={r['ratio']}" if mt == "fuzzy" else ""
        kept_src = r["kept"]["source"]
        dropped_src = r["dropped"]["source"]
        title = r["dropped"]["title"] or ""
        print(f"  [{mt}{ratio}] kept {kept_src!r} · dropped {dropped_src!r} · {title[:80]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
