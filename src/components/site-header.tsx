"use client";

import Link from "next/link";
import { CalendarPlus, Rss, Search } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full bg-mip-white/95 backdrop-blur border-b border-mip-gray-200">
      <div
        className="mx-auto flex items-center gap-6 px-6 py-4"
        style={{ maxWidth: "var(--max-width-content)" }}
      >
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0"
          aria-label="MIP Movement Calendar home"
        >
          <span
            className="mip-heading text-xl md:text-2xl"
            style={{ color: "var(--color-mip-purple)" }}
          >
            MIP <span className="hidden sm:inline">Movement</span> Calendar
          </span>
        </Link>

        <div className="flex-1" />

        {/* Nav actions */}
        <nav className="flex items-center gap-2 md:gap-4">
          <Link
            href="/subscribe"
            className="mip-nav-text hidden md:inline-flex items-center gap-1.5 hover:text-mip-purple transition-colors"
          >
            <Rss className="w-4 h-4" />
            <span>Subscribe</span>
          </Link>
          <Link
            href="/submit"
            className="mip-button-text inline-flex items-center gap-1.5 px-4 py-2 bg-mip-purple text-mip-white hover:opacity-90 transition-opacity"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            <CalendarPlus className="w-4 h-4" />
            <span className="hidden sm:inline">Submit Event</span>
            <span className="sm:hidden">Submit</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
