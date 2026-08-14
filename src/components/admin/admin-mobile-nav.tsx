"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import type { AdminRole } from "@/lib/types";
import { NAV } from "./nav-config";

interface Props {
  role: AdminRole;
  email: string;
}

/**
 * Mobile admin nav — hamburger button + slide-in drawer.
 *
 * Visible only below the md breakpoint. On tap, it opens a drawer from
 * the right containing every nav item the current role can see,
 * grouped by section (Wiki / Calendar / Gear / Admin), plus the
 * signed-in email and a sign-out link at the bottom.
 *
 * Uses the same source-of-truth NAV config as the desktop nav so the
 * two never drift.
 */
export function AdminMobileNav({ role, email }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close on Escape and lock scroll on body while open. (Route-change
  // close is handled per-link via onClick below — an effect on pathname
  // triggers a lint warning for setState in effect and would also fire
  // on server-driven revalidation.)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="md:hidden inline-flex items-center justify-center w-9 h-9 text-mip-gray-700 hover:bg-mip-gray-100 transition-colors"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          {/* Scrim */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/40"
          />

          {/* Drawer */}
          <div className="absolute inset-y-0 right-0 w-[85%] max-w-sm bg-mip-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-mip-gray-200">
              <span
                className="mip-heading text-lg"
                style={{ color: "var(--color-mip-purple)" }}
              >
                MIP Admin
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex items-center justify-center w-9 h-9 text-mip-gray-700 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-2">
              {NAV.map((entry, i) => {
                if (entry.kind === "link") {
                  const leaf = entry.leaf;
                  if (leaf.superOnly && role !== "super") return null;
                  const isActive = leaf.exact
                    ? pathname === leaf.href
                    : pathname.startsWith(leaf.href);
                  return (
                    <Link
                      key={leaf.href}
                      href={leaf.href}
                      onClick={() => setOpen(false)}
                      className={`block px-3 py-2.5 mip-button-text text-base transition-colors ${
                        isActive
                          ? "bg-mip-purple text-mip-white"
                          : "text-mip-gray-800 hover:bg-mip-gray-100"
                      }`}
                      style={{ borderRadius: "var(--radius-button)" }}
                    >
                      {leaf.label}
                    </Link>
                  );
                }

                const visible = entry.group.items.filter(
                  (it) => !it.superOnly || role === "super"
                );
                if (visible.length === 0) return null;

                return (
                  <div key={`${entry.group.label}-${i}`} className="mt-4">
                    <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-mip-gray-500">
                      {entry.group.label}
                    </div>
                    {visible.map((item) => {
                      const isActive = item.exact
                        ? pathname === item.href
                        : pathname.startsWith(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setOpen(false)}
                          className={`block px-3 py-2 mip-button-text text-sm transition-colors ${
                            isActive
                              ? "bg-mip-purple text-mip-white"
                              : "text-mip-gray-800 hover:bg-mip-gray-100"
                          }`}
                          style={{ borderRadius: "var(--radius-button)" }}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </nav>

            <div className="border-t border-mip-gray-200 px-4 py-3 space-y-2">
              <div className="text-xs text-mip-gray-500 truncate" title={email}>
                {email}
              </div>
              <a
                href="/admin/logout"
                className="block w-full text-center px-3 py-2 mip-button-text text-sm border border-mip-gray-300 hover:bg-mip-gray-100"
                style={{ borderRadius: "var(--radius-button)" }}
              >
                Sign out
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
