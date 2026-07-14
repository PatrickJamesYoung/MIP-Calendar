"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";

interface Overlay {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

interface Props {
  siteUrl: string;
  overlays: Overlay[];
}

export function SubscribePanel({ siteUrl, overlays }: Props) {
  const [selected, setSelected] = useState<"all" | string>("all");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const feedUrl =
    selected === "all"
      ? `${siteUrl}/calendar.ics`
      : `${siteUrl}/calendar.ics?overlay=${selected}`;
  // webcal:// URL — clicking this on iOS/macOS opens Apple Calendar directly.
  // Google can also import from https://; we surface the http variant there.
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");
  // Google Calendar's "Add by URL" prefill link
  const googleAddUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feedUrl)}`;

  async function copyFeed() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: nothing — the URL is right there for the user to select manually
    }
  }

  return (
    <div className="mt-8">
      {/* Overlay picker */}
      <div>
        <div className="mip-input-label mb-3">Which events?</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelected("all")}
            className="px-3 py-2 text-sm border transition-colors"
            style={{
              borderRadius: "var(--radius-button)",
              backgroundColor:
                selected === "all" ? "var(--color-mip-purple)" : "white",
              color: selected === "all" ? "white" : "var(--color-mip-gray-900)",
              borderColor:
                selected === "all"
                  ? "var(--color-mip-purple)"
                  : "var(--color-mip-gray-300)",
            }}
          >
            All calendars
          </button>
          {overlays.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelected(o.slug)}
              className="px-3 py-2 text-sm border transition-colors flex items-center gap-2"
              style={{
                borderRadius: "var(--radius-button)",
                backgroundColor:
                  selected === o.slug ? "var(--color-mip-purple)" : "white",
                color:
                  selected === o.slug ? "white" : "var(--color-mip-gray-900)",
                borderColor:
                  selected === o.slug
                    ? "var(--color-mip-purple)"
                    : "var(--color-mip-gray-300)",
              }}
            >
              {o.color && (
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: o.color }}
                />
              )}
              {o.name}
            </button>
          ))}
        </div>
      </div>

      {/* Feed URL card */}
      <div
        className="mt-6 p-5 border border-mip-gray-200"
        style={{
          borderRadius: "var(--radius-button)",
          backgroundColor: "var(--color-mip-gray-100)",
        }}
      >
        <div className="mip-input-label mb-2">Your subscription URL</div>
        <div className="flex items-stretch gap-2">
          <input
            readOnly
            value={feedUrl}
            className="flex-1 mip-input text-sm font-mono"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            type="button"
            onClick={copyFeed}
            className="px-3 flex items-center gap-1.5 text-sm font-medium border transition-colors whitespace-nowrap"
            style={{
              borderRadius: "var(--radius-button)",
              backgroundColor: copied
                ? "var(--color-mip-green, #10b981)"
                : "var(--color-mip-purple)",
              color: "white",
              borderColor: copied
                ? "var(--color-mip-green, #10b981)"
                : "var(--color-mip-purple)",
            }}
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy
              </>
            )}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={googleAddUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border transition-colors"
            style={{
              borderRadius: "var(--radius-button)",
              backgroundColor: "white",
              borderColor: "var(--color-mip-gray-300)",
              color: "var(--color-mip-gray-900)",
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Add to Google Calendar
          </a>
          <a
            href={webcalUrl}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border transition-colors"
            style={{
              borderRadius: "var(--radius-button)",
              backgroundColor: "white",
              borderColor: "var(--color-mip-gray-300)",
              color: "var(--color-mip-gray-900)",
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Add to Apple Calendar
          </a>
        </div>
      </div>

      {/* How-to details */}
      <div className="mt-8 space-y-2">
        <h2
          className="mip-heading text-lg"
          style={{ color: "var(--color-mip-purple)" }}
        >
          How to add it
        </h2>

        <Accordion
          id="google"
          title="Google Calendar (web)"
          open={expanded === "google"}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        >
          <ol className="list-decimal ml-5 space-y-1.5 text-sm">
            <li>
              Copy the subscription URL above (or click <strong>Add to Google Calendar</strong>).
            </li>
            <li>
              In Google Calendar, click the <strong>+</strong> next to{" "}
              <em>Other calendars</em> in the left sidebar.
            </li>
            <li>Choose <strong>From URL</strong>.</li>
            <li>Paste the URL and click <strong>Add calendar</strong>.</li>
            <li>
              It may take a few minutes to appear. Google refreshes external
              feeds roughly every 8-24 hours — new events will populate over
              that window.
            </li>
          </ol>
        </Accordion>

        <Accordion
          id="apple"
          title="Apple Calendar (Mac + iOS)"
          open={expanded === "apple"}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        >
          <div className="space-y-3 text-sm">
            <div>
              <strong>Easiest:</strong> Click <strong>Add to Apple Calendar</strong>{" "}
              above on your iPhone, iPad, or Mac. It will prompt you to
              subscribe.
            </div>
            <div>
              <strong>Manual (Mac):</strong>
              <ol className="list-decimal ml-5 mt-1 space-y-1">
                <li>Open Calendar → File → New Calendar Subscription</li>
                <li>Paste the subscription URL and click Subscribe</li>
                <li>Set Auto-refresh to <em>Every hour</em> for freshest events</li>
              </ol>
            </div>
            <div>
              <strong>Manual (iPhone/iPad):</strong>
              <ol className="list-decimal ml-5 mt-1 space-y-1">
                <li>Settings → Calendar → Accounts → Add Account → Other</li>
                <li>Add Subscribed Calendar</li>
                <li>Paste the URL and save</li>
              </ol>
            </div>
          </div>
        </Accordion>

        <Accordion
          id="outlook"
          title="Outlook (web)"
          open={expanded === "outlook"}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        >
          <ol className="list-decimal ml-5 space-y-1.5 text-sm">
            <li>Copy the subscription URL above.</li>
            <li>
              In Outlook Web, go to Calendar → <strong>Add calendar</strong> →{" "}
              <strong>Subscribe from web</strong>.
            </li>
            <li>Paste the URL, give it a name (e.g. "MIP Movement Calendar"), and click Import.</li>
          </ol>
        </Accordion>

        <Accordion
          id="fantastical"
          title="Other apps (Fantastical, Proton Calendar, etc.)"
          open={expanded === "fantastical"}
          onToggle={(id) => setExpanded(expanded === id ? null : id)}
        >
          <p className="text-sm">
            Any calendar app that supports iCal / ICS subscriptions will work.
            Look for a menu option like "Subscribe to calendar", "Add by URL",
            or "Import from URL" and paste the subscription URL above.
          </p>
        </Accordion>
      </div>

      {/* Tips / caveats */}
      <div className="mt-10 p-4 border-l-4 border-mip-purple bg-mip-gray-100">
        <div className="text-sm text-mip-gray-800 space-y-2">
          <p>
            <strong>How often does it update?</strong> The feed itself is always
            current. How quickly changes appear in your calendar app depends on
            that app — Google typically refreshes every 8-24 hours, Apple every
            hour if configured, Outlook every 3 hours.
          </p>
          <p>
            <strong>Want just one type of event?</strong> Use the calendar
            picker above to grab a filtered feed. You can even subscribe to
            multiple at once — each shows up as a separate calendar you can
            toggle on and off.
          </p>
        </div>
      </div>
    </div>
  );
}

function Accordion({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-mip-gray-200"
      style={{ borderRadius: "var(--radius-button)" }}
    >
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-mip-gray-100 transition-colors"
        style={{ borderRadius: "var(--radius-button)" }}
      >
        <span className="font-medium">{title}</span>
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" />
        )}
      </button>
      {open && (
        <div
          className="px-4 pb-4 pt-1 border-t border-mip-gray-200 text-mip-gray-800"
          style={{ backgroundColor: "var(--color-mip-white, #ffffff)" }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
