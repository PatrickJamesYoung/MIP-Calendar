#!/usr/bin/env python3
"""LLM classifier for PopVille + Busboys events.

runner.py writes `needs_llm.json` — the events from sources that require
manual classification (PopVille, Busboys). This script reads it, asks
Perplexity `sonar` to classify them in BATCHES (one HTTP call per batch of
up to BATCH_SIZE events), and rewrites `new_events.json` in place so events
classified as "Submit" have `submit == "Submit"` and the rest stay
"Don't Submit".

Batching cuts the number of Sonar calls by ~10-15x on a typical day
(10-20 candidates per run). We keep a small per-event fallback for the
rare case where the batch response can't be parsed.

Reads env:
    PPLX_API_KEY  — Perplexity API key for Sonar (optional; if unset, this
                    script no-ops and non-curated events stay "Don't Submit")

Reads files (in $RUN_DIR):
    needs_llm.json     — from runner.py
    new_events.json    — from runner.py; rewritten in place
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable

RUN_DIR = Path(os.environ["RUN_DIR"])
PPLX_API_KEY = os.environ.get("PPLX_API_KEY", "")

NEEDS_LLM = RUN_DIR / "needs_llm.json"
NEW_EVENTS = RUN_DIR / "new_events.json"

INSTRUCTION = (
    "You classify community-events for a progressive-movement calendar. "
    "For EACH numbered event below, decide whether it is a "
    "progressive movement / political / activist / social-justice / "
    "community-organizing event. Purely social, commercial, or apolitical "
    "arts/food events are NOT eligible. "
    "Respond with a single JSON object on one line: "
    '{"decisions": [{"id": <int>, "verdict": "Submit" | "Don\'t Submit"}, ...]} '
    "with one entry per input event, in the same order. Output NOTHING else."
)

# Sonar can comfortably handle 20-30 short items per request. We cap at 20
# to keep the response well under the model's token budget and to keep the
# JSON short enough that a single parse failure doesn't cost too much.
BATCH_SIZE = 20

# Max chars of description we send per event. Keeps per-request token cost
# bounded even for verbose sources (Busboys blurbs run long).
DESC_MAX_CHARS = 400

REQUEST_URL = "https://api.perplexity.ai/chat/completions"
REQUEST_TIMEOUT = 45


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _sonar_call(payload: dict) -> str:
    """POST to Sonar and return the assistant text. Raises on transport error."""
    req = urllib.request.Request(
        REQUEST_URL,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {PPLX_API_KEY}",
        },
        data=json.dumps(payload).encode("utf-8"),
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content", "")


def _build_batch_payload(events: list[dict]) -> dict:
    """Assemble a single Sonar request that asks about N events at once."""
    lines = []
    for i, ev in enumerate(events):
        title = (ev.get("title") or "").strip().replace("\n", " ")
        desc = (ev.get("description") or "").strip().replace("\n", " ")[:DESC_MAX_CHARS]
        lines.append(f"{i}. Title: {title}\n   Description: {desc}")
    user_content = "\n\n".join(lines)
    return {
        "model": "sonar",
        "messages": [
            {"role": "system", "content": INSTRUCTION},
            {"role": "user", "content": user_content},
        ],
        # Enough room for {"decisions":[{"id":0,"verdict":"Don't Submit"},...]}
        # for BATCH_SIZE=20 that's ~800 tokens at the outside; give headroom.
        "max_tokens": 1200,
        "temperature": 0,
    }


# Any of these substrings anywhere in the (lowercased) verdict text means
# "don't submit". Ordered from most specific to most general.
_DONT_SUBMIT_MARKERS = (
    "don't submit",
    "don t submit",
    "do not submit",
    "not submit",
    "dont submit",
    "no submit",
    "reject",
    "skip",
    "ineligible",
    "not eligible",
)


def _parse_verdict(text: str) -> str:
    """Normalize a free-form verdict string to 'Submit' or 'Don't Submit'."""
    t = text.strip().lower()
    if any(marker in t for marker in _DONT_SUBMIT_MARKERS):
        return "Don't Submit"
    if "submit" in t or t == "yes" or t.startswith("yes"):
        return "Submit"
    return "Don't Submit"


def _parse_batch_response(text: str, expected: int) -> list[str] | None:
    """
    Try to parse Sonar's response into `expected` verdict strings.
    Returns None if we can't extract exactly `expected` decisions.
    """
    # Strip common code fences and extract the first JSON object we see.
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if fence:
        text = fence.group(1)
    else:
        # Grab from the first { to the last }
        m = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if m:
            text = m.group(0)

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None

    decisions = parsed.get("decisions") if isinstance(parsed, dict) else None
    if not isinstance(decisions, list) or len(decisions) != expected:
        return None

    out: list[str] = [""] * expected
    for entry in decisions:
        if not isinstance(entry, dict):
            return None
        idx = entry.get("id")
        verdict = entry.get("verdict")
        if not isinstance(idx, int) or not 0 <= idx < expected:
            return None
        if not isinstance(verdict, str):
            return None
        out[idx] = _parse_verdict(verdict)

    if any(v == "" for v in out):
        return None
    return out


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def _classify_one_fallback(ev: dict) -> str:
    """Per-event fallback when the batch parse fails. Same shape as before."""
    payload = {
        "model": "sonar",
        "messages": [
            {
                "role": "system",
                "content": (
                    "Given an event title and description, decide if this is a "
                    "progressive movement / political / activist / social-justice / "
                    "community-organizing event. Output ONLY 'Submit' or 'Don't Submit'."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Title: {ev.get('title', '')}\n"
                    f"Description: {(ev.get('description') or '')[:DESC_MAX_CHARS]}"
                ),
            },
        ],
        "max_tokens": 40,
        "temperature": 0,
    }
    try:
        text = _sonar_call(payload)
    except Exception as e:  # noqa: BLE001
        print(f"  [llm] fallback failed for {ev.get('title')!r}: {e}", file=sys.stderr)
        return "Don't Submit"
    return _parse_verdict(text)


def classify_batch(events: list[dict]) -> list[str]:
    """
    Classify a batch of up to BATCH_SIZE events in one Sonar call.
    On parse or transport failure, fall back to per-event calls.
    """
    if not events:
        return []
    payload = _build_batch_payload(events)
    try:
        text = _sonar_call(payload)
    except Exception as e:  # noqa: BLE001
        print(f"  [llm] batch call failed ({len(events)} events): {e}", file=sys.stderr)
        return [_classify_one_fallback(ev) for ev in events]

    parsed = _parse_batch_response(text, len(events))
    if parsed is not None:
        return parsed

    print(
        f"  [llm] batch response unparseable ({len(events)} events); "
        f"falling back to per-event calls. Raw head: {text[:200]!r}",
        file=sys.stderr,
    )
    return [_classify_one_fallback(ev) for ev in events]


def _chunks(seq: list[dict], size: int) -> Iterable[list[dict]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _key(ev: dict) -> tuple[str, str, str]:
    """Dedup key — matches runner.py's (source, title, date) shape."""
    return (
        (ev.get("source") or "").strip().lower(),
        (ev.get("title") or "").strip().lower(),
        (ev.get("date") or "").strip(),
    )


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

    if not PPLX_API_KEY:
        print("[classify] PPLX_API_KEY not set — leaving all events as 'Don't Submit'")
        return

    batches = list(_chunks(needs, BATCH_SIZE))
    print(
        f"[classify] classifying {len(needs)} events in {len(batches)} "
        f"batch(es) of up to {BATCH_SIZE}"
    )

    decisions: dict[tuple[str, str, str], str] = {}
    for batch_idx, batch in enumerate(batches, start=1):
        verdicts = classify_batch(batch)
        for ev, verdict in zip(batch, verdicts):
            decisions[_key(ev)] = verdict
            print(
                f"  [batch {batch_idx}] {ev.get('source')} · "
                f"{(ev.get('title') or '')[:60]!r} → {verdict}"
            )

    # Apply decisions back to new_events.
    applied = 0
    for ev in new_events:
        k = _key(ev)
        if k in decisions:
            ev["submit"] = decisions[k]
            applied += 1

    NEW_EVENTS.write_text(json.dumps(new_events, indent=1))
    submitted = sum(1 for ev in new_events if ev.get("submit") == "Submit")
    print(
        f"[classify] done. Applied {applied} decisions. "
        f"Total 'Submit' events in new_events.json: {submitted}"
    )


if __name__ == "__main__":
    main()
