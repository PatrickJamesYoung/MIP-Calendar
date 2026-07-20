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
    # Mobilize org allowlist. Keep in sync with the `orgs` dict in
    # ingest/vendor/runner.py::parse_mobilize().
    #
    # For large national orgs, first-page-only fetch would miss DC events
    # buried deep in the ordering. Adding zipcode=20005 (~50mi radius from DC)
    # scopes the API to DC-area events server-side. Small/DC-native orgs
    # don't get this filter because their location metadata is sparse and
    # zipcode filtering drops most of their events (e.g. DC WFP virtual
    # events return 0 under zipcode filter).
    NATIONAL_ORGS = {93, 7229, 1377}  # Indivisible, John Lewis Actions, Color Of Change
    orgs = [1723, 32348, 2339, 1377, 34282, 93, 7229]
    for oid in orgs:
        query = "?timeslot_start=gte_now&per_page=50"
        if oid in NATIONAL_ORGS:
            query += "&zipcode=20005"
        _fetch(
            f"https://api.mobilize.us/v1/organizations/{oid}/events{query}",
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


# Number of most-recent slugs (from top of the Action Network group page,
# which lists upcoming/newest first) to fetch detail pages for. 60 is enough
# headroom for any realistic upcoming-event backlog while staying cheap.
_METRO_DC_DSA_MAX_SLUGS = 60


def fetch_metro_dc_dsa() -> None:
    """Fetch Metro DC DSA (Action Network) events.

    Action Network group pages list events client-side via JS (all 700+
    events push()'d into a JS array), but the raw HTML embeds those
    push() calls, so we can extract slugs directly. The group page lists
    upcoming events first, so we fetch detail pages for only the top N
    slugs.

    Each event page has a ?nowrapper=true variant that returns server-
    rendered HTML with the date/time/location parseable via regex.
    """
    import re
    from concurrent.futures import ThreadPoolExecutor, as_completed

    group_dest = RUN_DIR / "raw_metro_dc_dsa_group.html"
    _fetch(
        "https://actionnetwork.org/groups/metro-dc-dsa",
        group_dest,
        kind="html",
    )

    group_html = ""
    try:
        group_html = group_dest.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"  [metro-dc-dsa] could not read group page: {e}", file=sys.stderr)
        return

    # Extract event slugs from the embedded JS push() calls.
    slug_matches = re.findall(
        r'group_public_action_list_array\.push\(\{\s*li_wrapper:\s*\'<a\s+href="'
        r'https://actionnetwork\.org/events/([^"/?]+)"',
        group_html,
    )
    seen: set[str] = set()
    slugs: list[str] = []
    for s in slug_matches:
        if s not in seen:
            seen.add(s)
            slugs.append(s)

    slugs = slugs[:_METRO_DC_DSA_MAX_SLUGS]
    print(f"  [metro-dc-dsa] found {len(slug_matches)} slugs; fetching top {len(slugs)}")

    def _fetch_one(slug: str) -> None:
        url = f"https://actionnetwork.org/events/{slug}?nowrapper=true"
        dest = RUN_DIR / f"raw_metro_dc_dsa_{slug}.html"
        _fetch(url, dest, kind="html")

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(_fetch_one, s) for s in slugs]
        for _ in as_completed(futures):
            pass


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


def write_trumba_from_db() -> None:
    """Populate runner.py's `raw_trumba.json` with rows from THIS calendar's
    database so its fuzzy-match dedup path fires against what we've already
    published or queued — not against a retired Trumba feed.

    Naming note: `raw_trumba.json` is a legacy filename inside runner.py from
    when Trumba was the source of truth. Trumba is being deprecated; this
    calendar's DB is now authoritative. We keep the filename because we
    vowed not to modify runner.py, but conceptually this is
    "raw_current_calendar.json".

    The runner's fuzzy matcher (SequenceMatcher, 0.72 threshold, strips the
    "Free DC " prefix) catches cross-publisher duplicates like a Grassroots
    DC listing of the same event a Free DC listing already has in our DB.

    We reuse existing_rows.json (already fetched from /api/ingest/dedup-state)
    and translate each row to `{title, startDateTime}` — the exact fields
    load_trumba() accepts.
    """
    ex_path = RUN_DIR / "existing_rows.json"
    if not ex_path.exists():
        (RUN_DIR / "raw_trumba.json").write_text("[]", encoding="utf-8")
        return
    try:
        rows = json.loads(ex_path.read_text(encoding="utf-8"))
    except Exception:
        (RUN_DIR / "raw_trumba.json").write_text("[]", encoding="utf-8")
        return

    items = []
    seen: set[tuple[str, str]] = set()
    for r in rows:
        if len(r) < 3:
            continue
        title = (r[1] or "").strip()
        date = (r[2] or "").strip()
        if not title or not date:
            continue
        # Deduplicate on (title, date) so we don't waste comparison cycles.
        key = (title.lower(), date)
        if key in seen:
            continue
        seen.add(key)
        # runner.py's load_trumba parses startDateTime[:10] as YYYY-MM-DD.
        try:
            m, d, y = date.split("/")
            iso = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except Exception:
            continue
        items.append({"title": title, "startDateTime": iso})

    (RUN_DIR / "raw_trumba.json").write_text(
        json.dumps(items, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[trumba-compat] {len(items)} rows for fuzzy dedup")


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
    fetch_metro_dc_dsa()
    print("[fetch] Dedup + Trumba compat:")
    fetch_existing_rows()
    write_trumba_from_db()
    print("[fetch] done.")


if __name__ == "__main__":
    main()
