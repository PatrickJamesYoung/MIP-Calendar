#!/usr/bin/env python3
"""LLM classifier for PopVille + Busboys events.

runner.py writes `needs_llm.json` — the events from sources that require
manual classification (PopVille, Busboys). This script reads it, calls the
Perplexity SDK per event (or a batch endpoint if configured), and rewrites
`new_events.json` in place so events classified as "Submit" have
`submit == "Submit"` and the rest are marked "Don't Submit".

Reads env:
    PPLX_API_KEY  — Perplexity API key for Sonar (optional; if unset, this
                    script no-ops and non-curated events stay "Don't Submit")

Reads files (in $RUN_DIR):
    needs_llm.json     — from runner.py
    new_events.json    — from runner.py; rewritten in place

The prompt is copied from config.md:
    "Given an event title and description, decide if this is a progressive
    movement / political / activist / social-justice / community-organizing
    event. Output ONLY 'Submit' or 'Don't Submit'."
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RUN_DIR = Path(os.environ["RUN_DIR"])
PPLX_API_KEY = os.environ.get("PPLX_API_KEY", "")

NEEDS_LLM = RUN_DIR / "needs_llm.json"
NEW_EVENTS = RUN_DIR / "new_events.json"

INSTRUCTION = (
    "Given an event title and description, decide if this is a progressive "
    "movement / political / activist / social-justice / community-organizing "
    "event. Output ONLY 'Submit' or 'Don't Submit'."
)


def classify_one(title: str, description: str) -> str:
    """Return 'Submit' or 'Don't Submit'. Errors default to 'Don't Submit'."""
    if not PPLX_API_KEY:
        return "Don't Submit"

    body = {
        "model": "sonar",
        "messages": [
            {"role": "system", "content": INSTRUCTION},
            {"role": "user", "content": f"Title: {title}\nDescription: {description[:400]}"},
        ],
        "max_tokens": 40,
        "temperature": 0,
    }
    req = urllib.request.Request(
        "https://api.perplexity.ai/chat/completions",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {PPLX_API_KEY}",
        },
        data=json.dumps(body).encode("utf-8"),
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [llm] failed for {title!r}: {e}", file=sys.stderr)
        return "Don't Submit"

    text = ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "")
    text_lc = text.strip().lower()
    if "don" in text_lc and "submit" in text_lc:
        return "Don't Submit"
    if "submit" in text_lc:
        return "Submit"
    return "Don't Submit"


def main() -> None:
    if not NEEDS_LLM.exists():
        print("[classify] no needs_llm.json — skipping")
        return
    if not NEW_EVENTS.exists():
        print("[classify] no new_events.json — skipping")
        return

    needs = json.loads(NEEDS_LLM.read_text())
    new_events = json.loads(NEW_EVENTS.read_text())

    if not needs:
        print("[classify] 0 events to classify")
        return

    print(f"[classify] classifying {len(needs)} events...")

    # Build a lookup keyed by (source, title, date) — matches how runner.py
    # dedupes.
    def key(ev: dict) -> tuple[str, str, str]:
        return (
            (ev.get("source") or "").strip().lower(),
            (ev.get("title") or "").strip().lower(),
            (ev.get("date") or "").strip(),
        )

    decisions: dict[tuple[str, str, str], str] = {}
    for ev in needs:
        decision = classify_one(ev.get("title", ""), ev.get("description", ""))
        decisions[key(ev)] = decision
        print(f"  {ev.get('source')} · {ev.get('title')[:60]!r} → {decision}")

    # Apply decisions back to new_events.
    for ev in new_events:
        k = key(ev)
        if k in decisions:
            ev["submit"] = decisions[k]

    NEW_EVENTS.write_text(json.dumps(new_events, indent=1))
    submitted = sum(1 for ev in new_events if ev.get("submit") == "Submit")
    print(f"[classify] done. Total 'Submit' events: {submitted}")


if __name__ == "__main__":
    main()
