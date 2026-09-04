"use client";

import { useState, useTransition, useEffect, useMemo, useRef } from "react";
import Script from "next/script";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2, Users } from "lucide-react";
import { submitSpaceReservationAction } from "./actions";

interface SpaceLine {
  slug: string;
  name: string;
  category: string | null;
  capacity: number | null;
  ratePerHour: number;
}

interface Props {
  spaces: SpaceLine[];
  donationMinHours: number;
  donationDisclaimer: string;
  tierLabels: { full: string; mid: string; low: string };
  tierMultipliers: { full: number; mid: number; low: number };
  /** Tier chosen on the /spaces menu; carried through the URL. */
  initialTier: "full" | "mid" | "low";
  /** Slug of the space that triggers the equipment follow-up. Empty = disabled. */
  artProductionSlug: string;
  /** Options shown as checkboxes when the art-production space is selected. */
  artProductionEquipment: string[];
  turnstileSiteKey: string | null;
}

type Tier = "full" | "mid" | "low";

/**
 * Returns "YYYY-MM-DDTHH:MM" for the next full hour in America/New_York
 * plus an offset in hours. Used to seed sensible defaults on all four
 * datetime fields.
 */
function nextHourNyDatetimeLocal(offsetHours = 24): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const y = parseInt(get("year"));
  const mo = parseInt(get("month"));
  const d = parseInt(get("day"));
  let h = parseInt(get("hour")) === 24 ? 0 : parseInt(get("hour"));
  h = h + 1 + offsetHours;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  return `${yy}-${mm}-${dd}T${hh}:00`;
}

type State =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; humanId: string };

export function ReserveSpacesForm({
  spaces,
  donationMinHours,
  donationDisclaimer,
  tierLabels,
  tierMultipliers,
  initialTier,
  artProductionSlug,
  artProductionEquipment,
  turnstileSiteKey,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [pending, startTransition] = useTransition();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainerRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // Four datetimes: load-in 24h out, event +1h, event ends +3h from event start,
  // load-out 30min after event end.
  const [loadIn, setLoadIn] = useState(() => nextHourNyDatetimeLocal(24));
  const [eventStart, setEventStart] = useState(() =>
    nextHourNyDatetimeLocal(25)
  );
  const [eventEnd, setEventEnd] = useState(() => nextHourNyDatetimeLocal(27));
  const [loadOut, setLoadOut] = useState(() => nextHourNyDatetimeLocal(28));

  // Sliding-scale tier is chosen on the /spaces menu and passed through
  // the URL. We keep it in state (and forward via a hidden input) so the
  // donation preview here can react without another round trip.
  const [tier] = useState<Tier>(initialTier);

  // Auto-fill event start/end and load-out when the user changes load-in,
  // but only while those downstream fields still hold auto-generated values.
  // Once a user manually edits any of them, we stop overwriting.
  const autoFilledStartRef = useRef(nextHourNyDatetimeLocal(25));
  const autoFilledEndRef = useRef(nextHourNyDatetimeLocal(27));
  const autoFilledOutRef = useRef(nextHourNyDatetimeLocal(28));

  useEffect(() => {
    const li = new Date(loadIn);
    if (Number.isNaN(li.getTime())) return;

    // Only cascade when downstream fields still match the last auto-fill.
    const startIsAuto = eventStart === autoFilledStartRef.current;
    const endIsAuto = eventEnd === autoFilledEndRef.current;
    const outIsAuto = loadOut === autoFilledOutRef.current;

    if (!startIsAuto && !endIsAuto && !outIsAuto) return;

    const fmt = (d: Date) => {
      const yy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${yy}-${mm}-${dd}T${hh}:${mi}`;
    };

    const nextStart = fmt(new Date(li.getTime() + 60 * 60 * 1000));
    const nextEnd = fmt(new Date(li.getTime() + 3 * 60 * 60 * 1000));
    const nextOut = fmt(new Date(li.getTime() + 4 * 60 * 60 * 1000));

    if (startIsAuto && nextStart !== eventStart) {
      autoFilledStartRef.current = nextStart;
      setEventStart(nextStart);
    }
    if (endIsAuto && nextEnd !== eventEnd) {
      autoFilledEndRef.current = nextEnd;
      setEventEnd(nextEnd);
    }
    if (outIsAuto && nextOut !== loadOut) {
      autoFilledOutRef.current = nextOut;
      setLoadOut(nextOut);
    }
  }, [loadIn, eventStart, eventEnd, loadOut]);

  // Equipment follow-up: only shown when the configured art-production
  // space is in the selection AND there are options to pick from.
  const showEquipmentSection =
    artProductionSlug.length > 0 &&
    artProductionEquipment.length > 0 &&
    spaces.some((sp) => sp.slug === artProductionSlug);
  const [equipment, setEquipment] = useState<string[]>([]);

  function toggleEquipment(item: string) {
    setEquipment((prev) =>
      prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item]
    );
  }

  // Donation math (mirrors server-side calc)
  const { hoursRaw, hoursBilled, rateSum, subtotalFull, contributionTotal } =
    useMemo(() => {
      const li = new Date(loadIn);
      const lo = new Date(loadOut);
      const rateSum = spaces.reduce((sum, sp) => sum + sp.ratePerHour, 0);
      const multiplier = tierMultipliers[tier] ?? 1;
      if (Number.isNaN(li.getTime()) || Number.isNaN(lo.getTime()) || lo <= li) {
        const subtotal = Math.round(rateSum * donationMinHours * 100) / 100;
        return {
          hoursRaw: 0,
          hoursBilled: donationMinHours,
          rateSum,
          subtotalFull: subtotal,
          contributionTotal: Math.round(subtotal * multiplier * 100) / 100,
        };
      }
      const raw = (lo.getTime() - li.getTime()) / 3_600_000;
      const billed = Math.max(Math.ceil(raw * 100) / 100, donationMinHours);
      const subtotal = Math.round(rateSum * billed * 100) / 100;
      return {
        hoursRaw: raw,
        hoursBilled: billed,
        rateSum,
        subtotalFull: subtotal,
        contributionTotal: Math.round(subtotal * multiplier * 100) / 100,
      };
    }, [loadIn, loadOut, spaces, donationMinHours, tier, tierMultipliers]);

  // Turnstile setup
  useEffect(() => {
    if (!turnstileSiteKey || turnstileWidgetIdRef.current) return;
    const container = turnstileContainerRef.current;
    if (!container) return;
    const w = window as unknown as {
      turnstile?: {
        render: (
          el: HTMLElement,
          opts: {
            sitekey: string;
            callback: (t: string) => void;
            "expired-callback"?: () => void;
            "error-callback"?: () => void;
          }
        ) => string;
      };
    };
    if (!w.turnstile) return;
    turnstileWidgetIdRef.current = w.turnstile.render(container, {
      sitekey: turnstileSiteKey,
      callback: (t: string) => setTurnstileToken(t),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
  }, [turnstileSiteKey]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "success") return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (turnstileSiteKey && !turnstileToken) {
      setState({ kind: "error", message: "Please complete the captcha." });
      return;
    }
    if (turnstileToken) fd.set("cf-turnstile-response", turnstileToken);
    fd.set("spaces", spaces.map((s) => s.slug).join(","));
    fd.set("org_tier", tier);
    // Persist equipment as a JSON array so it round-trips cleanly even
    // if an item contains a comma.
    if (showEquipmentSection) {
      fd.set("equipment_requested", JSON.stringify(equipment));
    }

    startTransition(async () => {
      const result = await submitSpaceReservationAction(fd);
      if (result.ok) {
        setState({ kind: "success", humanId: result.humanId });
      } else {
        setState({ kind: "error", message: result.error });
      }
    });
  }

  if (state.kind === "success") {
    return (
      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5" />
          <div>
            <h2 className="font-medium text-emerald-900">
              Request submitted — {state.humanId}
            </h2>
            <p className="mt-1 text-sm text-emerald-800">
              We received your request and will follow up shortly. Please keep
              an eye on your inbox for a confirmation email.
            </p>
            <div className="mt-4">
              <Link
                href="/spaces"
                className="text-sm font-medium text-emerald-900 hover:underline"
              >
                ← Back to spaces
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {turnstileSiteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => {
            const w = window as unknown as {
              turnstile?: {
                render: (
                  el: HTMLElement,
                  opts: {
                    sitekey: string;
                    callback: (t: string) => void;
                  }
                ) => string;
              };
            };
            const container = turnstileContainerRef.current;
            if (
              !w.turnstile ||
              !container ||
              turnstileWidgetIdRef.current
            )
              return;
            turnstileWidgetIdRef.current = w.turnstile.render(container, {
              sitekey: turnstileSiteKey,
              callback: (t: string) => setTurnstileToken(t),
            });
          }}
        />
      )}

      <form className="mt-8 space-y-8" onSubmit={onSubmit}>
        {/* Selected spaces */}
        <section className="rounded-lg border border-mip-gray-200 bg-white p-5">
          <h2 className="font-medium text-mip-gray-900 mb-3">
            Requested {spaces.length === 1 ? "space" : "spaces"}
          </h2>
          <ul className="divide-y divide-mip-gray-100">
            {spaces.map((sp) => (
              <li key={sp.slug} className="py-2 flex items-baseline justify-between gap-4">
                <div>
                  <div className="font-medium text-mip-gray-900">{sp.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-mip-gray-500">
                    {sp.capacity != null && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" /> up to {sp.capacity}
                      </span>
                    )}
                    {sp.category && <span>{sp.category}</span>}
                  </div>
                </div>
                <div className="text-sm text-mip-gray-700 whitespace-nowrap">
                  {sp.ratePerHour > 0
                    ? `$${sp.ratePerHour.toFixed(0)}/hr`
                    : "—"}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Link
              href={`/spaces?spaces=${encodeURIComponent(
                spaces.map((s) => s.slug).join(",")
              )}`}
              className="text-xs text-mip-purple hover:underline"
            >
              ← Edit selection
            </Link>
          </div>
        </section>

        {/* Times */}
        <section className="rounded-lg border border-mip-gray-200 bg-white p-5">
          <h2 className="font-medium text-mip-gray-900 mb-1">When?</h2>
          <p className="text-xs text-mip-gray-500 mb-4">
            All four times are required. Recommended donation is calculated on
            load-in through load-out (with a {donationMinHours}-hour minimum).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimeField
              label="Load-in"
              hint="When do you want to get in the space?"
              name="load_in_at"
              value={loadIn}
              onChange={setLoadIn}
            />
            <TimeField
              label="Event start"
              hint="Your event officially begins."
              name="event_start_at"
              value={eventStart}
              onChange={setEventStart}
            />
            <TimeField
              label="Event end"
              hint="Your event ends."
              name="event_end_at"
              value={eventEnd}
              onChange={setEventEnd}
            />
            <TimeField
              label="Load-out"
              hint="When will you be done cleaning up and loading out?"
              name="load_out_at"
              value={loadOut}
              onChange={setLoadOut}
            />
          </div>
        </section>

        {/* Requester */}
        <section className="rounded-lg border border-mip-gray-200 bg-white p-5">
          <h2 className="font-medium text-mip-gray-900 mb-4">Your details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField
              label="Your name"
              name="requester_name"
              required
              autoComplete="name"
            />
            <TextField
              label="Email"
              name="requester_email"
              type="email"
              required
              autoComplete="email"
            />
            <TextField
              label="Phone"
              name="requester_phone"
              type="tel"
              autoComplete="tel"
            />
            <TextField
              label="Organization"
              name="organization"
              autoComplete="organization"
            />
          </div>
          <div className="mt-4">
            <TextField
              label="Event title"
              name="event_title"
              required
              maxLength={200}
              placeholder="e.g. Coalition planning meeting"
            />
          </div>
          <div className="mt-4">
            <label className="block text-sm text-mip-gray-700 mb-1">
              What is this space for? <span className="text-mip-purple">*</span>
            </label>
            <textarea
              name="event_description"
              required
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 rounded-md border border-mip-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/30"
              placeholder="Meeting, training, event — describe what you'll be doing and roughly how many people you're expecting."
            />
          </div>

          {/* Tier is chosen on the /spaces menu page; forwarded here through
              the URL. We just render a small summary + link to change. */}
          <div className="mt-4 rounded-md border border-mip-gray-200 bg-mip-gray-50 p-3 text-sm text-mip-gray-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs uppercase tracking-wide text-mip-gray-500">
                  Sliding scale
                </span>
                <div className="font-medium text-mip-gray-900">
                  {tierLabels[tier]}
                  <span className="ml-1 text-xs font-normal text-mip-gray-500">
                    ({Math.round((tierMultipliers[tier] ?? 1) * 100)}%)
                  </span>
                </div>
              </div>
              <Link
                href="/spaces"
                className="text-xs text-mip-purple hover:underline"
              >
                Change
              </Link>
            </div>
          </div>
        </section>

        {showEquipmentSection && (
          <section className="rounded-lg border border-mip-gray-200 bg-white p-5">
            <h2 className="font-medium text-mip-gray-900 mb-1">
              Are you hoping to use any of our equipment?
            </h2>
            <p className="text-xs text-mip-gray-500 mb-3">
              Optional. Check anything you&rsquo;d like to use — we&rsquo;ll
              make sure it&rsquo;s available.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
              {artProductionEquipment.map((item) => (
                <label
                  key={item}
                  className="flex items-start gap-2 text-sm text-mip-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={equipment.includes(item)}
                    onChange={() => toggleEquipment(item)}
                    className="mt-1"
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </section>
        )}

        {/* Donation summary */}
        <section className="rounded-lg border border-mip-gray-200 bg-white p-5">
          <h2 className="font-medium text-mip-gray-900 mb-3">
            Suggested donation
          </h2>
          <dl className="space-y-1 text-sm text-mip-gray-700">
            <div className="flex justify-between">
              <dt>Requested hours (load-in → load-out)</dt>
              <dd className="font-medium">
                {hoursRaw > 0 ? `${hoursRaw.toFixed(1)}h` : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Hours billed ({donationMinHours}-hour minimum)</dt>
              <dd className="font-medium">{hoursBilled.toFixed(1)}h</dd>
            </div>
            <div className="flex justify-between">
              <dt>Per-hour rate ({spaces.length} space{spaces.length === 1 ? "" : "s"})</dt>
              <dd className="font-medium">${rateSum.toFixed(0)}/hr</dd>
            </div>
            <div className="flex justify-between">
              <dt>Full-rate subtotal</dt>
              <dd className="font-medium">${subtotalFull.toFixed(0)}</dd>
            </div>
            {(tierMultipliers[tier] ?? 1) !== 1 && (
              <div className="flex justify-between text-xs text-mip-gray-500">
                <dt>Sliding-scale adjustment</dt>
                <dd>×{(tierMultipliers[tier] ?? 1).toFixed(2)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-mip-gray-100 pt-2 mt-2 text-base text-mip-gray-900">
              <dt className="font-medium">Recommended</dt>
              <dd className="font-medium">${contributionTotal.toFixed(0)}</dd>
            </div>
          </dl>
          {donationDisclaimer && (
            <p className="mt-3 text-xs text-mip-gray-500">
              {donationDisclaimer}
            </p>
          )}
        </section>

        {/* Ack + captcha */}
        <section className="space-y-4">
          <label className="flex items-start gap-3 text-sm text-mip-gray-700">
            <input
              type="checkbox"
              name="acknowledged_tentative"
              value="true"
              required
              className="mt-1"
            />
            <span>
              I understand that submitting this form is a request, not a
              confirmed booking. Someone from MIP will follow up to confirm.
            </span>
          </label>

          {turnstileSiteKey && (
            <div ref={turnstileContainerRef} className="cf-turnstile" />
          )}

          {state.kind === "error" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 flex items-start gap-2 text-sm text-red-900">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{state.message}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/spaces?spaces=${encodeURIComponent(
                spaces.map((s) => s.slug).join(",")
              )}`}
              className="text-sm text-mip-gray-500 hover:text-mip-gray-900"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: "var(--color-mip-purple)" }}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </section>
      </form>
    </>
  );
}

function TextField({
  label,
  name,
  required,
  type = "text",
  autoComplete,
  maxLength,
  placeholder,
}: {
  label: string;
  name: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm text-mip-gray-700 mb-1">
        {label}
        {required && <span className="text-mip-purple"> *</span>}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        autoComplete={autoComplete}
        maxLength={maxLength}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md border border-mip-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/30"
      />
    </div>
  );
}

function TimeField({
  label,
  hint,
  name,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-mip-gray-700 mb-1">
        {label} <span className="text-mip-purple">*</span>
      </label>
      <input
        type="datetime-local"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full px-3 py-2 rounded-md border border-mip-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/30"
      />
      <p className="mt-1 text-xs text-mip-gray-500">{hint}</p>
    </div>
  );
}
