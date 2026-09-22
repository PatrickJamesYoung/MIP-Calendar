/**
 * Deterministic HTML renderer for the Daybook and Weekly Planner.
 *
 * NO LLM in this path. Given a validated DaybookComposition, output
 * email-safe HTML. Empty sections are dropped (Patrick's preference:
 * omit non-substantive sections rather than showing "N/A").
 *
 * For the Notion mirror, use renderForNotion() which skips weather
 * and produces a compact structure suitable for a Notion block payload.
 */

import type { DaybookComposition } from "./types";

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function section(title: string, body: string): string {
  if (!body.trim()) return "";
  return `<section style="margin:24px 0"><h2 style="font-size:18px;margin:0 0 8px">${esc(title)}</h2>${body}</section>`;
}

function timeLabel(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return iso;
  }
}

export function renderEmailHtml(comp: DaybookComposition): string {
  const parts: string[] = [];

  if (comp.intro) {
    parts.push(`<p style="margin:0 0 16px">${esc(comp.intro)}</p>`);
  }

  // Weather is email-only. Never rendered for Notion.
  if (comp.edition === "daybook" && comp.weather_email_only) {
    const w = comp.weather_email_only;
    const range = w.high_f && w.low_f ? ` — ${w.low_f}° / ${w.high_f}°` : "";
    parts.push(section("Weather", `<p style="margin:0">${esc(w.summary)}${esc(range)}</p>`));
  }

  parts.push(section("Movement calendar", renderList(comp.movement_calendar, (it) =>
    `<strong>${esc(it.title)}</strong> — ${timeLabel(it.start)}` +
    (it.location ? ` · ${esc(it.location)}` : "") +
    (it.url ? ` · <a href="${esc(it.url)}">details</a>` : "")
  )));

  parts.push(section("White House", renderList(comp.white_house, (it) =>
    `<strong>${esc(it.time)}</strong> — ${esc(it.description)}`
  )));

  parts.push(section("Congress", renderList(comp.congress, (it) =>
    `<strong>${esc(it.committee)}</strong> (${esc(it.chamber)}) — ${esc(it.title)}, ${timeLabel(it.start)}`
  )));

  parts.push(section("Supreme Court", renderList(comp.scotus, (it) =>
    `<strong>${esc(it.title)}</strong> — ${esc(it.summary)}` +
    (it.url ? ` · <a href="${esc(it.url)}">source</a>` : "")
  )));

  parts.push(section("DC government", renderList(comp.dc_gov, (it) =>
    `<strong>${esc(it.agency)}</strong> — ${esc(it.title)}` +
    (it.start ? ` (${timeLabel(it.start)})` : "")
  )));

  parts.push(section("AlertDC", renderList(comp.alert_dc, (it) =>
    `<strong>${esc(it.headline)}</strong>`
  )));

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">${parts.filter(Boolean).join("")}</body></html>`;
}

function renderList<T>(items: T[], line: (it: T) => string): string {
  if (items.length === 0) return "";
  const lis = items.map((it) => `<li style="margin:6px 0">${line(it)}</li>`).join("");
  return `<ul style="padding-left:20px;margin:0">${lis}</ul>`;
}

/**
 * Compact Notion-mirror JSON. Weather is stripped per user preference.
 * The API route posts this to Notion via MCP or the Notion REST API.
 */
export function renderForNotion(comp: DaybookComposition) {
  return {
    edition: comp.edition,
    publication_date: comp.publication_date,
    subject: comp.subject,
    intro: comp.intro,
    // weather intentionally omitted
    sections: {
      movement_calendar: comp.movement_calendar,
      white_house: comp.white_house,
      congress: comp.congress,
      scotus: comp.scotus,
      dc_gov: comp.dc_gov,
      alert_dc: comp.alert_dc,
    },
  };
}
