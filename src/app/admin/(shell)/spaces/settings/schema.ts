/**
 * Schema hints for spaces_settings.
 *
 * spaces_settings is (key, value jsonb, notes) — same shape as
 * gear_settings. We keep a schema table here so the UI renders sensible
 * controls (text, number, HTML rich editor) and coerces values back to
 * the right jsonb shape.
 */

export type SpaceSettingType = "string" | "number" | "html";

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
];
