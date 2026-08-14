"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AdminRole } from "@/lib/types";
import { NAV, type NavGroup } from "./nav-config";

interface Props {
  role: AdminRole;
}

/**
 * Desktop admin nav. Hidden on mobile — see `AdminMobileNav` for that.
 */
export function AdminNav({ role }: Props) {
  const pathname = usePathname();

  return (
    <nav className="hidden md:flex items-center gap-1">
      {NAV.map((entry, i) => {
        if (entry.kind === "link") {
          const leaf = entry.leaf;
          if (leaf.superOnly && role !== "super") return null;
          const isActive = leaf.exact
            ? pathname === leaf.href
            : pathname.startsWith(leaf.href);
          return (
            <NavLink
              key={leaf.href}
              href={leaf.href}
              active={isActive}
              label={leaf.label}
            />
          );
        }

        // Group: filter items by role first — if empty after filtering, skip.
        const visibleItems = entry.group.items.filter(
          (it) => !it.superOnly || role === "super"
        );
        if (visibleItems.length === 0) return null;

        return (
          <NavDropdown
            key={`${entry.group.label}-${i}`}
            group={{ ...entry.group, items: visibleItems }}
            pathname={pathname}
          />
        );
      })}
    </nav>
  );
}

function NavLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={`mip-button-text px-3 py-1.5 transition-colors ${
        active
          ? "bg-mip-purple text-mip-white"
          : "text-mip-gray-700 hover:bg-mip-gray-100"
      }`}
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {label}
    </Link>
  );
}

function NavDropdown({
  group,
  pathname,
}: {
  group: NavGroup;
  pathname: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const groupActive = group.activePrefixes.some((prefix) =>
    pathname.startsWith(prefix)
  );

  // Close on outside click and on Escape. Keeps behavior predictable
  // without pulling in a dropdown library.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`mip-button-text px-3 py-1.5 inline-flex items-center gap-1 transition-colors ${
          groupActive
            ? "bg-mip-purple text-mip-white"
            : "text-mip-gray-700 hover:bg-mip-gray-100"
        }`}
        style={{ borderRadius: "var(--radius-button)" }}
      >
        {group.label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 min-w-[10rem] border border-mip-gray-200 bg-white shadow-md py-1 z-50"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          {group.items.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block px-3 py-1.5 mip-button-text text-sm transition-colors ${
                  isActive
                    ? "bg-mip-purple/10 text-mip-purple"
                    : "text-mip-gray-700 hover:bg-mip-gray-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
