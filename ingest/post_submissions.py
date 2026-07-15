#!/usr/bin/env python3
"""POST new_events.json → /api/ingest/submissions.

Reads env:
    RUN_DIR              — where new_events.json lives
    INGEST_API_BASE      — e.g. https://mip-calendar.vercel.app
    INGEST_BEARER_TOKEN  — bearer token
    RUN_ID               — GitHub Actions run id (optional; used to tag the
                           ingestion_runs row)

The API is idempotent: same (source_name, source_external_id) pair is
absorbed as a conflict and returned in `skipped`, so re-runs are safe.
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

RUN_DIR = Path(os.environ["RUN_DIR"])
API_BASE = os.environ["INGEST_API_BASE"].rstrip("/")
TOKEN = os.environ["INGEST_BEARER_TOKEN"]
RUN_ID = os.environ.get("RUN_ID", "")

NEW_EVENTS = RUN_DIR / "new_events.json"


def main() -> None:
    if not NEW_EVENTS.exists():
        print("[post] no new_events.json — nothing to post")
        return

    events = json.loads(NEW_EVENTS.read_text())
    if not events:
        print("[post] 0 events to post")
        return

    submit_count = sum(1 for e in events if e.get("submit") == "Submit")
    print(f"[post] posting {len(events)} events ({submit_count} marked Submit)...")

    payload = {"run_id": RUN_ID, "events": events}
    req = urllib.request.Request(
        f"{API_BASE}/api/ingest/submissions",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {TOKEN}",
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    print(f"[post] response: {json.dumps(body, indent=2)}")
    # Sanity: if we sent Submit-marked events but nothing was inserted or
    # skipped-as-duplicate, something went wrong upstream.
    if (
        body.get("submitted_count", 0) == 0
        and body.get("skipped_count", 0) == 0
        and submit_count > 0
    ):
        print(f"[post] sanity check failed — no events processed", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
