#!/usr/bin/env python3
"""Fetch raw source files into $RUN_DIR for the DC events runner.

Outputs (one file per source, or per-org for Mobilize):
    raw_freedc.json
    raw_busboys.json
    raw_popville.html
    raw_grassroots.html
    raw_mobilize_{ORG_ID}.json   (6 files)
    raw_rhizome.html             (best-effort; JS-rendered, often 0)
    raw_festival_center.ics

Also generates:
    existing_rows.json           (fetched from /api/ingest/dedup-state)
    raw_trumba.json              (empty list — Trumba cross-check retired
                                  in favor of local DB dedup via
                                  existing_rows.json)

Reads:
    RUN_DIR                      workspace directory to write into
    INGEST_API_BASE              e.g. https://mip-calendar.vercel.app
    INGEST_BEARER_TOKEN          bearer token for /api/ingest/*

Non-goals: parsing. That's runner.py's job.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import requests

RUN_DIR = Path(os.environ["RUN_DIR"])
INGEST_API_BASE = os.environ.get("INGEST_API_BASE", "").rstrip("/")
INGEST_BEARER_TOKEN = os.environ.get("INGEST_BEARER_TOKEN", "")

RUN_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


def _fetch(url: str, dest: Path, kind: str = "text", extra_headers: dict[str, str] | None = None) -> None:
    """Fetch a URL and write to dest. Never raises — logs and swallows.

    Missing/failed fetches result in an empty-but-valid file so runner.py's
    per-source parser sees it as "0 events from this source" (which the
    escalation rule tolerates unless ALL sources return 0).
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    for k, v in (extra_headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read()
    except urllib.error.HTTPError as e:
        print(f"  [{dest.name}] HTTP {e.code} — writing empty {kind}", file=sys.stderr)
        dest.write_text("{}" if kind == "json" else "", encoding="utf-8")
        return
    except Exception as e:
        print(f"  [{dest.name}] fetch failed: {e} — writing empty {kind}", file=sys.stderr)
        dest.write_text("{}" if kind == "json" else "", encoding="utf-8")
        return

    if kind == "json":
        # Validate JSON, write bytes verbatim so downstream parsers see it as-is.
        try:
            json.loads(content.decode("utf-8"))
        except Exception as e:
            print(f"  [{dest.name}] invalid JSON: {e} — writing empty", file=sys.stderr)
            dest.write_text("{}", encoding="utf-8")
            return
    dest.write_bytes(content)
    print(f"  [{dest.name}] {len(content)} bytes ok")


def fetch_freedc() -> None:
    _fetch(
        "https://freedcproject.org/event-list?format=json",
        RUN_DIR / "raw_freedc.json",
        kind="json",
    )


def fetch_busboys() -> None:
    _fetch(
        "https://www.busboysandpoets.com/wp-json/wp/v2/events/more",
        RUN_DIR / "raw_busboys.json",
        kind="json",
    )


def fetch_popville() -> None:
    _fetch(
        "https://www.popville.com/events/",
        RUN_DIR / "raw_popville.html",
        kind="html",
    )


def fetch_grassroots() -> None:
    _fetch(
        "https://grassrootsdc.org/events-list",
        RUN_DIR / "raw_grassroots.html",
        kind="html",
    )


def fetch_mobilize() -> None:
    orgs = [1723, 32348, 2339, 1377, 34282, 93]
    for oid in orgs:
        _fetch(
            f"https://api.mobilize.us/v1/organizations/{oid}/events"
            f"?timeslot_start=gte_now&per_page=50",
            RUN_DIR / f"raw_mobilize_{oid}.json",
            kind="json",
        )


def fetch_rhizome() -> None:
    _fetch(
        "https://www.rhizomedc.org/events-list/",
        RUN_DIR / "raw_rhizome.html",
        kind="html",
    )


def fetch_festival_center() -> None:
    _fetch(
        "https://calendar.google.com/calendar/ical/"
        "uulp2pem0sbujuv1lm7nq774jkkqahb5%40import.calendar.google.com/public/basic.ics",
        RUN_DIR / "raw_festival_center.ics",
        kind="ics",
    )


def fetch_existing_rows() -> None:
    """Pull the dedup state from the calendar API and lay it out in the
    exact shape runner.py expects: a JSON list of [source, title, date, time]
    tuples. If the endpoint is unreachable, write an empty list so runner.py
    still runs (albeit without dedup — which is safe because our
    POST /api/ingest/submissions is itself idempotent on external_id).
    """
    if not INGEST_API_BASE or not INGEST_BEARER_TOKEN:
        print("[dedup] INGEST_API_BASE / INGEST_BEARER_TOKEN not set — using empty existing_rows", file=sys.stderr)
        (RUN_DIR / "existing_rows.json").write_text("[]", encoding="utf-8")
        return

    url = f"{INGEST_API_BASE}/api/ingest/dedup-state"
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": UA,
                "Authorization": f"Bearer {INGEST_BEARER_TOKEN}",
            },
            timeout=30,
        )
        resp.raise_for_status()
        body = resp.json()
    except Exception as e:
        print(f"[dedup] fetch failed: {e} — using empty existing_rows", file=sys.stderr)
        (RUN_DIR / "existing_rows.json").write_text("[]", encoding="utf-8")
        return

    rows = body.get("rows", [])
    # Force UTF-8 + ensure_ascii=False so unicode characters (e.g. \u2009
    # narrow-space in event titles) round-trip cleanly for runner.py.
    (RUN_DIR / "existing_rows.json").write_text(
        json.dumps(rows, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[dedup] {len(rows)} existing rows loaded")


def write_empty_trumba() -> None:
    """Trumba cross-check is retired; runner.py still reads raw_trumba.json,
    so we hand it an empty list. runner.py's Trumba matcher becomes a no-op,
    which is what we want — dedup happens entirely via existing_rows.json.
    """
    (RUN_DIR / "raw_trumba.json").write_text("[]")


def main() -> None:
    print(f"[fetch] RUN_DIR = {RUN_DIR}")
    print("[fetch] Sources:")
    fetch_freedc()
    fetch_busboys()
    fetch_popville()
    fetch_grassroots()
    fetch_mobilize()
    fetch_rhizome()
    fetch_festival_center()
    print("[fetch] Dedup + Trumba compat:")
    fetch_existing_rows()
    write_empty_trumba()
    print("[fetch] done.")


if __name__ == "__main__":
    main()
