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
export const CalendarItem = z.object({
  title: z.string().min(1),
  start: z.string(),            // ISO 8601 in America/New_York
  end: z.string().optional(),
  location: z.string().optional(),
  url: z.string().url().optional(),
  organizer: z.string().optional(),
});
export type CalendarItem = z.infer<typeof CalendarItem>;

/** A congressional committee hearing. Sourced from Congress.gov API. */
export const CommitteeHearing = z.object({
  chamber: z.enum(["house", "senate", "joint"]),
  committee: z.string().min(1),
  title: z.string().min(1),
  start: z.string(),
  room: z.string().optional(),
  url: z.string().url().optional(),
});
export type CommitteeHearing = z.infer<typeof CommitteeHearing>;

/** WH press-pool guidance item (Forth primary, FactBase fallback). */
export const WhiteHouseItem = z.object({
  time: z.string(),             // free-form ("10:15 AM ET") — pool text is inconsistent
  description: z.string().min(1),
  pool_status: z.string().optional(),
});
export type WhiteHouseItem = z.infer<typeof WhiteHouseItem>;

/** A DC Council or Mayor's Office item. */
export const DcGovItem = z.object({
  agency: z.string().min(1),
  title: z.string().min(1),
  start: z.string().optional(),
  url: z.string().url().optional(),
});
export type DcGovItem = z.infer<typeof DcGovItem>;

/** An AlertDC notice. */
export const AlertDcItem = z.object({
  headline: z.string().min(1),
  issued_at: z.string(),
  url: z.string().url().optional(),
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
  intro: z.string().optional(),
  movement_calendar: z.array(CalendarItem),
  white_house: z.array(WhiteHouseItem),
  congress: z.array(CommitteeHearing),
  scotus: z.array(z.object({
    title: z.string(),
    summary: z.string(),
    url: z.string().url().optional(),
  })),
  dc_gov: z.array(DcGovItem),
  alert_dc: z.array(AlertDcItem),
  // Weather is intentionally NOT in the schema for the Notion mirror path.
  // The email renderer reads a separate optional field only when edition
  // === 'daybook' AND the email destination is set — never in Notion.
  weather_email_only: z.object({
    summary: z.string(),
    high_f: z.number().int().optional(),
    low_f: z.number().int().optional(),
  }).optional(),
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
