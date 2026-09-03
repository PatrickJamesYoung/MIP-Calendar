/**
 * Schema hints for spaces_settings.
 *
 * spaces_settings is (key, value jsonb, notes) — same shape as
 * gear_settings. We keep a schema table here so the UI renders sensible
 * controls (text, number, HTML rich editor) and coerces values back to
 * the right jsonb shape.
 */

export type SpaceSettingType =
  | "string"
  | "number"
  | "html"
  /**
   * A list of strings, edited as one item per line in a textarea. Coerced
   * to a JSON array on save (blank lines dropped, each item trimmed).
   */
  | "string_list";

export interface SpaceSettingSpec {
  key: string;
  label: string;
  type: SpaceSettingType;
  help?: string;
}

/**
 * These are the keys the migration seeds. Anything else in the table
 * gets rendered as a raw-JSON textarea via the "Other" fallback so
 * the page never silently hides settings that exist in the DB.
 */
export const KNOWN_SPACE_SETTINGS: SpaceSettingSpec[] = [
  {
    key: "storefront_info_html",
    label: "Storefront info (HTML)",
    type: "html",
    help: "Rich HTML shown above the space grid on the public storefront.",
  },
  {
    key: "donation_min_hours",
    label: "Minimum billable hours",
    type: "number",
    help: "Floor applied to the hours used for the donation calculation. Keeps a 30-minute request from producing a token ask.",
  },
  {
    key: "donation_disclaimer",
    label: "Donation disclaimer",
    type: "string",
    help: "Copy shown under the donation summary on the request form.",
  },
  {
    key: "reservation_id_prefix",
    label: "Reservation ID prefix",
    type: "string",
    help: "Prefix used when minting human_id values, e.g. SPACE-20260827-A1B2.",
  },
  {
    key: "tier_full_label",
    label: "Sliding scale — full-rate label",
    type: "string",
    help: "Label shown next to the top tier on the reserve form.",
  },
  {
    key: "tier_mid_label",
    label: "Sliding scale — mid-rate label",
    type: "string",
    help: "Label shown next to the middle tier on the reserve form.",
  },
  {
    key: "tier_low_label",
    label: "Sliding scale — low-rate label",
    type: "string",
    help: "Label shown next to the low tier on the reserve form.",
  },
  {
    key: "tier_full_multiplier",
    label: "Sliding scale — full-rate multiplier",
    type: "number",
    help: "Multiplier applied to the full-rate subtotal for the top tier. Usually 1.",
  },
  {
    key: "tier_mid_multiplier",
    label: "Sliding scale — mid-rate multiplier",
    type: "number",
    help: "Multiplier applied to the full-rate subtotal for the middle tier.",
  },
  {
    key: "tier_low_multiplier",
    label: "Sliding scale — low-rate multiplier",
    type: "number",
    help: "Multiplier applied to the full-rate subtotal for the low tier.",
  },
  {
    key: "art_production_slug",
    label: "Art & production room slug",
    type: "string",
    help: "Slug of the space that triggers the equipment follow-up on the reserve form. Leave blank to disable the follow-up.",
  },
  {
    key: "art_production_equipment",
    label: "Art & production room equipment",
    type: "string_list",
    help: "One equipment option per line. These appear as checkboxes when the art & production room is in a request.",
  },
];
