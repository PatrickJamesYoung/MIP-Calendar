/**
 * Pre-send validation. This is the ONLY thing that stands between a bad
 * draft and subscriber inboxes. Every check here is deterministic — no
 * LLM in this path. If ANY check fails, the run is marked `blocked` and
 * `/api/daybook/send` refuses to call Buttondown.
 *
 * Add new checks liberally. False positives are fine; a false negative
 * (bad draft sent to subscribers) is the failure mode that killed the
 * Perplexity version.
 */

import type { DaybookComposition } from "./types";

export type ValidationCheck = {
  name: string;
  ok: boolean;
  detail?: string;
};

export type ValidationReport = {
  passed: boolean;
  checks: ValidationCheck[];
};

const PLACEHOLDER_PATTERNS = [
  /\{\{[^}]+\}\}/,                    // {{ template }}
  /\bTODO\b/i,
  /\bundefined\b/,
  /\[object Object\]/,
  /\bNaN\b/,
  /^null$/im,
];

export function validateDraft(args: {
  composition: DaybookComposition;
  html: string;
  subject: string;
  archiveUrlResolves: boolean;      // caller does HEAD check before invoking
  movementCalendarSourceCount: number;
}): ValidationReport {
  const { composition, html, subject, archiveUrlResolves, movementCalendarSourceCount } = args;
  const checks: ValidationCheck[] = [];

  // 1. Subject line dated correctly and non-empty.
  checks.push({
    name: "subject_present",
    ok: subject.trim().length > 0,
  });
  checks.push({
    name: "subject_includes_date",
    ok: subject.includes(formatSubjectDate(composition.publication_date)),
    detail: `expected date fragment "${formatSubjectDate(composition.publication_date)}" in subject "${subject}"`,
  });

  // 2. No template placeholders leaked into rendered HTML.
  for (const pat of PLACEHOLDER_PATTERNS) {
    const m = html.match(pat);
    checks.push({
      name: `no_placeholder_${pat.source.slice(0, 20)}`,
      ok: !m,
      detail: m ? `matched at ${m.index}: ${m[0]}` : undefined,
    });
  }

  // 3. Movement calendar count matches source.
  checks.push({
    name: "movement_calendar_count_matches_source",
    ok: composition.movement_calendar.length === movementCalendarSourceCount,
    detail: `composed=${composition.movement_calendar.length} source=${movementCalendarSourceCount}`,
  });

  // 4. Archive URL must resolve. Caller does the HEAD check.
  checks.push({
    name: "archive_url_resolves",
    ok: archiveUrlResolves,
  });

  // 5. HTML size sanity — reject anything absurdly small or huge.
  const bytes = new TextEncoder().encode(html).length;
  checks.push({
    name: "html_size_sane",
    ok: bytes >= 500 && bytes <= 500_000,
    detail: `bytes=${bytes}`,
  });

  // 6. Empty-but-nonzero sections should never render header-with-no-items.
  // The renderer is responsible for dropping empty sections; this catches
  // regressions where an empty section leaks through with a header.
  const emptySectionLeak = /<h[1-3][^>]*>[^<]*<\/h[1-3]>\s*<\/(?:div|section)>/i.test(html);
  checks.push({
    name: "no_empty_section_headers",
    ok: !emptySectionLeak,
  });

  // 7. Weather MUST NOT appear in Notion mirror path — but the mirror is a
  // separate renderer, so this check is deferred to the mirror step.

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}

function formatSubjectDate(iso: string): string {
  // "2026-09-22" -> "September 22, 2026"
  const [y, m, d] = iso.split("-").map(Number);
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${names[m - 1]} ${d}, ${y}`;
}
