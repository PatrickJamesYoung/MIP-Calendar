"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminRole } from "@/lib/types";

interface Props {
  role: AdminRole;
}

const NAV_ITEMS = [
  { href: "/admin", label: "Events", exact: true },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/overlays", label: "Calendars" },
  { href: "/admin/admins", label: "Admins", superOnly: true },
  { href: "/admin/import", label: "Import", superOnly: true },
  { href: "/admin/ingestion", label: "Ingestion", superOnly: true },
  { href: "/admin/audit", label: "Audit" },
];

export function AdminNav({ role }: Props) {
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-1">
      {NAV_ITEMS.filter((item) => !item.superOnly || role === "super").map(
        (item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mip-button-text px-3 py-1.5 transition-colors ${
                isActive
                  ? "bg-mip-purple text-mip-white"
                  : "text-mip-gray-700 hover:bg-mip-gray-100"
              }`}
              style={{ borderRadius: "var(--radius-button)" }}
            >
              {item.label}
            </Link>
          );
        }
      )}
    </nav>
  );
}
