#!/usr/bin/env python3
"""
Send a run-summary email via Resend after the ingest workflow finishes.

Reads what actually happened from the RUN_DIR artifacts (new_events.json +
post_response.json if present), so this works for both success and failure
paths. Emails silently no-op if RESEND_API_KEY is missing so devs can run
locally without configuring it.
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


def _build_summary(run_dir: Path) -> tuple[str, str]:
    """Return (subject_suffix, html_body_snippet) describing the run."""
    new_events = _load_json(run_dir / "new_events.json") or []
    post_response = _load_json(run_dir / "post_response.json") or {}

    by_source = Counter((e.get("source") or "?") for e in new_events)
    total_new = sum(by_source.values())

    # API returns submitted_count / skipped_count / needs_review_count.
    inserted = post_response.get("submitted_count")
    dropped = post_response.get("skipped_count") or 0
    needs_review = post_response.get("needs_review_count") or 0
    run_id_from_api = post_response.get("run_id") or post_response.get("ingestion_run_id")

    lines_html: list[str] = []
    lines_html.append(
        f"<p><strong>{total_new}</strong> new events after dedup.</p>"
    )

    if by_source:
        lines_html.append("<p><strong>By source:</strong></p><ul>")
        for src, n in sorted(by_source.items(), key=lambda kv: (-kv[1], kv[0])):
            lines_html.append(f"<li>{src}: {n}</li>")
        lines_html.append("</ul>")

    if inserted is not None:
        parts = [f"<strong>Submitted:</strong> {inserted}"]
        if needs_review:
            parts.append(f"needs review: {needs_review}")
        if dropped:
            parts.append(f"skipped as dup: {dropped}")
        if run_id_from_api:
            parts.append(f"run <code>{run_id_from_api}</code>")
        lines_html.append("<p>" + " &middot; ".join(parts) + "</p>")
    else:
        lines_html.append(
            "<p><em>No POST response found (dry run or workflow "
            "failed before submissions step).</em></p>"
        )

    subject_suffix = f"{total_new} new · {inserted or 0} submitted"
    if needs_review:
        subject_suffix += f" · {needs_review} to review"
    return subject_suffix, "".join(lines_html)


def main() -> int:
    api_key = os.environ.get("RESEND_API_KEY")
    to_addr = os.environ.get("NOTIFY_TO")
    from_addr = os.environ.get("NOTIFY_FROM")
    job_status = os.environ.get("JOB_STATUS", "unknown")
    run_url = os.environ.get("RUN_URL", "")
    run_id = os.environ.get("RUN_ID", "")
    run_dir_str = os.environ.get("RUN_DIR")

    if not api_key or not to_addr or not from_addr:
        print(
            "[email] RESEND_API_KEY / NOTIFY_TO / NOTIFY_FROM not all set — "
            "skipping email step (this is normal for local runs).",
            file=sys.stderr,
        )
        return 0

    run_dir = Path(run_dir_str) if run_dir_str else Path(".")
    subject_suffix, body_html = _build_summary(run_dir)

    status_label = job_status.upper() if job_status else "COMPLETED"
    subject = f"[MIP ingest {status_label}] {subject_suffix}"

    html = (
        f"<div style=\"font-family:system-ui,sans-serif;font-size:14px;color:#222;\">"
        f"<h2 style=\"margin:0 0 12px;color:#3f2b8e;\">MIP calendar ingest &mdash; {status_label}</h2>"
        f"{body_html}"
        f"<p style=\"margin-top:16px;\">"
        f"<a href=\"{run_url}\" style=\"color:#3f2b8e;\">View full run log &rarr;</a>"
        f" &middot; run <code>{run_id}</code>"
        f"</p>"
        f"</div>"
    )

    payload = {
        "from": from_addr,
        "to": [to_addr],
        "subject": subject,
        "html": html,
    }

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode()
            print(f"[email] Resend {resp.status}: {body[:200]}")
    except urllib.error.HTTPError as e:
        print(f"[email] Resend HTTP {e.code}: {e.read().decode()[:400]}", file=sys.stderr)
        # Don't fail the workflow just because the email failed.
        return 0
    except Exception as e:
        print(f"[email] Resend error: {e}", file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
