"use client";

import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";

/**
 * Header that mirrors movementinfrastructureproject.org so this app feels
 * like a natural part of the parent site. Logo and all top-level links
 * point back to the parent MIP site; the Movement Calendar and Borrow Gear
 * links open this app's own pages so people can still navigate between the
 * two here.
 *
 * Colors, font, and nav labels are taken directly from the parent site's
 * Squarespace header. Breakpoint (800px) matches the parent site.
 */

const MIP_ORIGIN = "https://www.movementinfrastructureproject.org";

interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

interface NavItem {
  label: string;
  href?: string;
  external?: boolean;
  children?: NavLink[];
}

// Top-level nav in the exact order the parent MIP site uses.
const NAV: NavItem[] = [
  {
    label: "About",
    children: [
      { label: "About", href: `${MIP_ORIGIN}/about`, external: true },
      { label: "Contact", href: `${MIP_ORIGIN}/contact`, external: true },
      { label: "Music", href: `${MIP_ORIGIN}/music`, external: true },
    ],
  },
  { label: "Donate", href: `${MIP_ORIGIN}/donate`, external: true },
  { label: "Updates", href: `${MIP_ORIGIN}/updates`, external: true },
  // Borrow Gear on the parent site routes visitors here; keep the same
  // label but link to our own /gear so people don't bounce out.
  { label: "Borrow Gear", href: "/gear" },
  // Same story for the calendar.
  { label: "Movement Calendar", href: "/calendar" },
  {
    label: "DC Resources",
    children: [
      {
        label: "Gear in the Streets!",
        href: `${MIP_ORIGIN}/gear-in-the-streets`,
        external: true,
      },
      {
        label: "DC Organizing Principles",
        href: `${MIP_ORIGIN}/dc-organizing-principles`,
        external: true,
      },
      {
        label: "Guide to Permitting Actions in DC",
        href: `${MIP_ORIGIN}/guide-to-permitting-actions-in-dc`,
        external: true,
      },
      {
        label: "Know Your Rights",
        href: `${MIP_ORIGIN}/know-your-rights`,
        external: true,
      },
      {
        label: "Trump's Daily Schedule",
        href: "https://rollcall.com/factbase/trump/calendar/",
        external: true,
      },
      {
        label: "Action Planning Map",
        href: "https://experience.arcgis.com/experience/14cc3e5b18d549a397defa94f94737d0",
        external: true,
      },
      {
        label: "DC Movement Daybook",
        href: "https://buttondown.com/MovementInfrastructureProject/archive/",
        external: true,
      },
    ],
  },
];

const LOGO_SRC =
  "https://images.squarespace-cdn.com/content/v1/65933fec321af07a2e0932d7/6b4e75e4-9bdc-4a92-9202-823e3f4fcffd/MovementInfrastructureProject-02.png?format=1500w";

export function MipSiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Track which desktop dropdown is open (label) so hover/focus works with
  // keyboard too. null = none open.
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <header
      className="mip-site-header w-full border-b border-mip-gray-200 bg-mip-white"
      style={{ fontFamily: '"Work Sans", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="mx-auto flex items-center gap-4 px-6 py-4" style={{ maxWidth: "1200px" }}>
        {/* Logo — links back to the parent MIP site */}
        <a
          href={MIP_ORIGIN}
          aria-label="Movement Infrastructure Project home"
          className="shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_SRC}
            alt="Movement Infrastructure Project"
            width={155}
            height={87}
            className="block h-[50px] w-auto"
            loading="eager"
          />
        </a>

        <div className="flex-1" />

        {/* Desktop nav — visible ≥800px */}
        <nav
          className="hidden items-center gap-6 [@media(min-width:800px)]:flex"
          aria-label="Site"
        >
          {NAV.map((item) =>
            item.children ? (
              <DesktopDropdown
                key={item.label}
                item={item}
                open={openMenu === item.label}
                onOpenChange={(open) =>
                  setOpenMenu(open ? item.label : null)
                }
              />
            ) : (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="text-[15px] font-medium text-black hover:text-mip-purple transition-colors"
              >
                {item.label}
              </a>
            )
          )}
        </nav>

        {/* Mobile hamburger — visible <800px */}
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="[@media(min-width:800px)]:hidden inline-flex items-center justify-center rounded-md p-2 text-black hover:bg-mip-gray-100"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="[@media(min-width:800px)]:hidden border-t border-mip-gray-200 bg-mip-white">
          <nav
            aria-label="Site (mobile)"
            className="mx-auto flex flex-col px-6 py-4"
            style={{ maxWidth: "1200px" }}
          >
            {NAV.map((item) => (
              <MobileItem key={item.label} item={item} />
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}

function DesktopDropdown({
  item,
  open,
  onOpenChange,
}: {
  item: NavItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div
      className="relative"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center gap-1 text-[15px] font-medium text-black hover:text-mip-purple transition-colors"
      >
        {item.label}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && item.children && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-md border border-mip-gray-200 bg-mip-white py-2 shadow-lg"
        >
          {item.children.map((child) => (
            <a
              key={child.label}
              href={child.href}
              target={child.external ? "_blank" : undefined}
              rel={child.external ? "noopener noreferrer" : undefined}
              role="menuitem"
              className="block px-4 py-2 text-[14px] text-black hover:bg-mip-gray-100 hover:text-mip-purple"
            >
              {child.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileItem({ item }: { item: NavItem }) {
  const [expanded, setExpanded] = useState(false);
  if (!item.children) {
    return (
      <a
        href={item.href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener noreferrer" : undefined}
        className="border-b border-mip-gray-100 py-3 text-[16px] font-medium text-black hover:text-mip-purple"
      >
        {item.label}
      </a>
    );
  }
  return (
    <div className="border-b border-mip-gray-100">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between py-3 text-left text-[16px] font-medium text-black"
      >
        {item.label}
        <ChevronDown
          className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {expanded && (
        <div className="pb-2 pl-4">
          {item.children.map((child) => (
            <a
              key={child.label}
              href={child.href}
              target={child.external ? "_blank" : undefined}
              rel={child.external ? "noopener noreferrer" : undefined}
              className="block py-2 text-[15px] text-black hover:text-mip-purple"
            >
              {child.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
