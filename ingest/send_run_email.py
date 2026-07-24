#!/usr/bin/env python3
"""
POST a run summary to /api/ingest/notify, which emails the admins via
the app's existing Resend integration. Called from the ingest workflow
after each run (success or failure — the workflow uses if: always()).

Env:
    RUN_DIR              — new_events.json + post_response.json live here
    INGEST_API_BASE      — https://mip-calendar.vercel.app
    INGEST_BEARER_TOKEN  — same token as the other /api/ingest/* endpoints
    RUN_ID, RUN_URL      — GitHub Actions context
    JOB_STATUS           — job.status from the workflow ("success" | "failure" | ...)
    DRY_RUN              — "true" if this was a dry-run trigger (optional)

Silently no-ops (exit 0) if INGEST_API_BASE / INGEST_BEARER_TOKEN aren't
set so local runs don't need to configure notifications.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from collections import Counter
from pathlib import Path


def _load_json(p: Path):
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def main() -> int:
    api_base = (os.environ.get("INGEST_API_BASE") or "").rstrip("/")
    token = os.environ.get("INGEST_BEARER_TOKEN")
    if not api_base or not token:
        print(
            "[notify] INGEST_API_BASE / INGEST_BEARER_TOKEN not set — "
            "skipping email step (this is normal for local runs).",
            file=sys.stderr,
        )
        return 0

    run_dir_str = os.environ.get("RUN_DIR")
    run_dir = Path(run_dir_str) if run_dir_str else Path(".")

    new_events = _load_json(run_dir / "new_events.json") or []
    post_response = _load_json(run_dir / "post_response.json") or {}

    by_source = Counter((e.get("source") or "?") for e in new_events)
    total_new = sum(by_source.values())

    # /api/ingest/submissions returns submitted_count / skipped_count / needs_review_count.
    inserted = post_response.get("submitted_count") if post_response else None
    skipped = (post_response.get("skipped_count") or 0) if post_response else 0
    needs_review = (post_response.get("needs_review_count") or 0) if post_response else 0

    subject_suffix = f"{total_new} new"
    if inserted is not None:
        subject_suffix += f" \u00b7 {inserted} submitted"
    if needs_review:
        subject_suffix += f" \u00b7 {needs_review} to review"

    body = {
        "subject_suffix": subject_suffix,
        "status": os.environ.get("JOB_STATUS") or "completed",
        "run_id": os.environ.get("RUN_ID") or "",
        "run_url": os.environ.get("RUN_URL") or "",
        "total_new": total_new,
        "inserted": inserted,
        "needs_review": needs_review,
        "skipped": skipped,
        "by_source": dict(by_source),
        "dry_run": (os.environ.get("DRY_RUN") or "").lower() == "true",
    }

    req = urllib.request.Request(
        f"{api_base}/api/ingest/notify",
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"[notify] {resp.status}: {resp.read().decode()[:200]}")
    except urllib.error.HTTPError as e:
        # Don't fail the workflow over email problems — log and move on.
        print(
            f"[notify] HTTP {e.code}: {e.read().decode()[:400]}",
            file=sys.stderr,
        )
    except Exception as e:
        print(f"[notify] error: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
