/**
 * Shared TypeScript types mirroring the Supabase schema.
 * When the DB schema changes, update these to match.
 */

export type LocationType = "in_person" | "online" | "hybrid";

export type EventStatus =
  | "published"
  | "pending"
  | "rejected"
  | "archived"
  | "draft";

export type EventSource = "admin" | "submission" | "csv" | "trumba";

export type SubmissionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "needs_edit"
  | "duplicate";

export type AdminRole = "super" | "admin";

export type AccessibilityFeature =
  | "asl"
  | "childcare"
  | "captioning"
  | "physical_access"
  | "elder_seating"
  | "spanish"
  | "other";

export interface OverlayCalendar {
  id: string;
  name: string;
  slug: string;
  color: string;
  default_visible: boolean;
  sort_order: number;
  description: string | null;
}

export interface EventType {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  sort_order: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  timezone: string;
  location_type: LocationType | null;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  image_url: string | null;
  event_type_id: string | null;
  event_type?: EventType;
  cost: string | null;
  host_org: string | null;
  accessibility: AccessibilityFeature[];
  web_link: string | null;
  overlay_calendar_id: string | null;
  overlay_calendar?: OverlayCalendar;
  is_featured: boolean;
  featured_until: string | null;
  featured_sort_order: number | null;
  status: EventStatus;
  source: EventSource;
  external_id: string | null;
  rrule: string | null;
  created_at: string;
  updated_at: string;
}

export const ACCESSIBILITY_LABELS: Record<AccessibilityFeature, string> = {
  asl: "ASL interpretation",
  childcare: "Childcare offered",
  captioning: "Live captioning",
  physical_access: "Physically accessible",
  elder_seating: "Seating for elders",
  spanish: "Spanish interpretation",
  other: "Other accommodations",
};
