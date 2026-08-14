/**
 * Shared nav configuration for the admin console.
 *
 * Consumed by both the desktop dropdown nav (`admin-nav.tsx`) and the
 * mobile drawer (`admin-mobile-nav.tsx`). Keep this file the single
 * source of truth for what's in the admin nav.
 */

export interface NavLeaf {
  href: string;
  label: string;
  exact?: boolean;
  superOnly?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavLeaf[];
  /**
   * Path prefixes that should mark this group as active. Kept explicit
   * rather than derived from items so /admin/events/[id]/edit can flag
   * Calendar as active without listing every child route.
   */
  activePrefixes: string[];
}

export type NavEntry =
  | { kind: "link"; leaf: NavLeaf }
  | { kind: "group"; group: NavGroup };

export const NAV: NavEntry[] = [
  {
    kind: "link",
    leaf: { href: "/admin/wiki", label: "Wiki" },
  },
  {
    kind: "group",
    group: {
      label: "Calendar",
      activePrefixes: [
        "/admin/events",
        "/admin/submissions",
        "/admin/overlays",
        "/admin/import",
      ],
      items: [
        { href: "/admin/events", label: "Events" },
        { href: "/admin/submissions", label: "Submissions" },
        { href: "/admin/overlays", label: "Calendars" },
        { href: "/admin/import", label: "Import", superOnly: true },
      ],
    },
  },
  {
    kind: "group",
    group: {
      label: "Gear",
      activePrefixes: ["/admin/gear"],
      items: [
        { href: "/admin/gear", label: "Requests", exact: true },
        { href: "/admin/gear/catalog", label: "Catalog" },
        { href: "/admin/gear/templates", label: "Email templates" },
        { href: "/admin/gear/settings", label: "Settings" },
      ],
    },
  },
  {
    kind: "group",
    group: {
      label: "Admin",
      activePrefixes: ["/admin/admins", "/admin/ingestion", "/admin/audit"],
      items: [
        { href: "/admin/admins", label: "Admins" },
        { href: "/admin/ingestion", label: "Ingestion", superOnly: true },
        { href: "/admin/audit", label: "Audit" },
      ],
    },
  },
];
