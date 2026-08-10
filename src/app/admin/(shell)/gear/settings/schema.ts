/**
 * Schema hints for gear_settings.
 *
 * Rows are stored as (key text, value jsonb). We keep a schema table
 * here so the UI can render sensible controls (number input, textarea,
 * email-list textarea) and coerce string form values back to the right
 * jsonb shape. Unknown keys fall back to a raw-JSON textarea.
 */

export type SettingType = "string" | "number" | "email-list" | "json" | "raw";

export interface SettingSpec {
  key: string;
  label: string;
  type: SettingType;
  group: "org" | "policy" | "storefront" | "communication" | "tiers" | "integrations";
  help?: string;
  placeholder?: string;
  superOnly?: boolean;
}

export const KNOWN_SETTINGS: SettingSpec[] = [
  // --- Org identity ---
  {
    key: "organization_name",
    label: "Organization name",
    type: "string",
    group: "org",
    help: "Shown in the storefront header and outgoing emails.",
  },
  {
    key: "email_from_name",
    label: "Email from-name",
    type: "string",
    group: "org",
    help: "From-name on outgoing email.",
  },
  {
    key: "donation_url",
    label: "Donation URL",
    type: "string",
    group: "org",
    help: "Included in confirmation and follow-up emails.",
  },
  {
    key: "storefront_base_url",
    label: "Storefront base URL",
    type: "string",
    group: "org",
    help: "Public URL of the storefront (used in confirmation emails).",
  },

  // --- Reservation policy ---
  {
    key: "min_notice_hours",
    label: "Minimum notice (hours)",
    type: "number",
    group: "policy",
    help: "Reject requests submitted less than this many hours before pickup.",
  },
  {
    key: "buffer_hours",
    label: "Reservation buffer (hours)",
    type: "number",
    group: "policy",
    help: "Padding added before and after each reservation for prep/return.",
  },
  {
    key: "followup_delay_days",
    label: "Follow-up delay (days after return)",
    type: "number",
    group: "policy",
    help: "How many days after the return date to send the follow-up email.",
  },
  {
    key: "followup_days_after_return",
    label: "Follow-up days (legacy)",
    type: "number",
    group: "policy",
    help: "Legacy setting from Apps Script. Kept for backwards compatibility — set to 0 to disable there.",
  },
  {
    key: "tentative_disclaimer",
    label: "Tentative disclaimer",
    type: "string",
    group: "policy",
    help: "Shown on checkout and in the acknowledgement email.",
  },

  // --- Storefront pickup defaults ---
  {
    key: "default_pickup_location",
    label: "Default pickup location",
    type: "string",
    group: "storefront",
    help: "Pre-fills on the reservation review page.",
  },
  {
    key: "default_organizer_contact_name",
    label: "Default organizer contact (name)",
    type: "string",
    group: "storefront",
  },
  {
    key: "default_organizer_contact_phone",
    label: "Default organizer contact (phone)",
    type: "string",
    group: "storefront",
  },

  // --- Communication ---
  {
    key: "organizer_emails",
    label: "Organizer notification emails",
    type: "email-list",
    group: "communication",
    help: "Comma- or newline-separated. Receives new-request emails.",
    placeholder: "info@movementinfrastructureproject.org",
  },

  // --- Tiers ---
  {
    key: "tier_full_label",
    label: "Tier 1 label (full)",
    type: "string",
    group: "tiers",
  },
  {
    key: "tier_full_multiplier",
    label: "Tier 1 multiplier",
    type: "number",
    group: "tiers",
  },
  {
    key: "tier_mid_label",
    label: "Tier 2 label (mid)",
    type: "string",
    group: "tiers",
  },
  {
    key: "tier_mid_multiplier",
    label: "Tier 2 multiplier",
    type: "number",
    group: "tiers",
  },
  {
    key: "tier_low_label",
    label: "Tier 3 label (low)",
    type: "string",
    group: "tiers",
  },
  {
    key: "tier_low_multiplier",
    label: "Tier 3 multiplier",
    type: "number",
    group: "tiers",
  },
  {
    key: "tier_multipliers",
    label: "org_tier multiplier map (JSON)",
    type: "json",
    group: "tiers",
    help: "Multipliers applied to subtotal_full to compute contribution_total, keyed by org_tier.",
    superOnly: true,
  },

  // --- Integrations (advanced / super-admin) ---
  {
    key: "admin_link",
    label: "Apps Script admin link",
    type: "string",
    group: "integrations",
    help: "Legacy Apps Script admin URL.",
    superOnly: true,
  },
  {
    key: "admin_token",
    label: "Apps Script admin token",
    type: "string",
    group: "integrations",
    superOnly: true,
  },
  {
    key: "approval_base_url",
    label: "Approval base URL",
    type: "string",
    group: "integrations",
    superOnly: true,
  },
  {
    key: "pipedream_webhook_url",
    label: "Pipedream webhook URL",
    type: "string",
    group: "integrations",
    help: "Optional Pipedream endpoint that receives JSON on every new request.",
    superOnly: true,
  },
];

export const GROUPS: {
  id: SettingSpec["group"];
  label: string;
  description?: string;
}[] = [
  { id: "org", label: "Organization", description: "Name, from-name, donation link, storefront URL." },
  { id: "policy", label: "Reservation policy", description: "Notice, buffers, disclaimers, follow-up cadence." },
  { id: "storefront", label: "Storefront defaults", description: "Pre-fills for the review page." },
  { id: "communication", label: "Communication", description: "Who gets notified on new requests." },
  { id: "tiers", label: "Contribution tiers", description: "Labels and multipliers by org_tier." },
  { id: "integrations", label: "Integrations", description: "Advanced — legacy Apps Script + webhooks." },
];
