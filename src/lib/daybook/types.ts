/**
 * Daybook types + Zod schemas.
 *
 * The composed JSON produced by the LLM step MUST validate against
 * `DaybookComposition`. If validation fails, the run is marked `failed`
 * and no send happens. Never loosen these schemas without also updating
 * the pre-send validator in `validation.ts`.
 */

import { z } from "zod";

export type DaybookEdition = "daybook" | "weekly";

/** A single item on the movement calendar. Sourced from mip-calendar ICS. */
// Inner optional fields use .nullish() (accepts null AND undefined) so
// the JSON Schema generated from these Zod types describes them as
// nullable. Models targeting a strict JSON schema emit `null` rather than
// omitting keys, and a plain .optional() rejects null. All fields marked
// nullish below are also declared nullable in the DB, so the semantics
// hold end-to-end.
export const CalendarItem = z.object({
  title: z.string().min(1),
  start: z.string(),            // ISO 8601 in America/New_York
  end: z.string().nullish(),
  location: z.string().nullish(),
  url: z.string().url().nullish(),
  organizer: z.string().nullish(),
});
export type CalendarItem = z.infer<typeof CalendarItem>;

/** A congressional committee hearing. Sourced from Congress.gov API. */
export const CommitteeHearing = z.object({
  chamber: z.enum(["house", "senate", "joint"]),
  committee: z.string().min(1),
  title: z.string().min(1),
  start: z.string(),
  room: z.string().nullish(),
  url: z.string().url().nullish(),
});
export type CommitteeHearing = z.infer<typeof CommitteeHearing>;

/** WH press-pool guidance item (Forth primary, FactBase fallback). */
export const WhiteHouseItem = z.object({
  time: z.string(),             // free-form ("10:15 AM ET") — pool text is inconsistent
  description: z.string().min(1),
  pool_status: z.string().nullish(),
});
export type WhiteHouseItem = z.infer<typeof WhiteHouseItem>;

/** A DC Council or Mayor's Office item. */
export const DcGovItem = z.object({
  agency: z.string().min(1),
  title: z.string().min(1),
  start: z.string().nullish(),
  url: z.string().url().nullish(),
});
export type DcGovItem = z.infer<typeof DcGovItem>;

/** An AlertDC notice. */
export const AlertDcItem = z.object({
  headline: z.string().min(1),
  issued_at: z.string(),
  url: z.string().url().nullish(),
});
export type AlertDcItem = z.infer<typeof AlertDcItem>;

/**
 * The full composed briefing. Empty arrays are allowed and mean "section
 * omitted" — the renderer drops empty sections per Patrick's preference
 * (no "N/A" filler in Notion or email).
 */
export const DaybookComposition = z.object({
  edition: z.enum(["daybook", "weekly"]),
  publication_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  subject: z.string().min(1),
  intro: z.string().nullish(),
  movement_calendar: z.array(CalendarItem),
  white_house: z.array(WhiteHouseItem),
  congress: z.array(CommitteeHearing),
  scotus: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string().url().nullish(),
  })),
  dc_gov: z.array(DcGovItem),
  alert_dc: z.array(AlertDcItem),
  // Weather is intentionally NOT in the schema for the Notion mirror path.
  // The email renderer reads a separate optional field only when edition
  // === 'daybook' AND the email destination is set — never in Notion.
  // Nullish (accepts null AND undefined) matches PR #61's pattern: models
  // targeting a strict JSON schema emit null for absent objects, not
  // omitted keys. The renderer already checks truthiness before use, so
  // accepting null is safe.
  weather_email_only: z.object({
    summary: z.string(),
    high_f: z.number().int().nullish(),
    low_f: z.number().int().nullish(),
  }).nullish(),
});
export type DaybookComposition = z.infer<typeof DaybookComposition>;

/** Source keys — used as `daybook_sources.source_key`. */
export const SOURCE_KEYS = [
  "mip_calendar",
  "forth",
  "factbase",
  "congress",
  "alert_dc",
  "scotus",
  "mayor",
  "dc_council",
] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

/** Which sources are hard-required. If any hard source fails, the run aborts. */
export const HARD_REQUIRED_SOURCES: SourceKey[] = ["mip_calendar"];

/** At least one of these must succeed. */
export const AT_LEAST_ONE_OF: SourceKey[][] = [["forth", "factbase"]];
