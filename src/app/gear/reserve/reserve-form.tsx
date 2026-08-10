"use client";

import { useState, useTransition, useEffect } from "react";
import Script from "next/script";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { submitReservationAction } from "./actions";

interface Line {
  slug: string;
  name: string;
  unit: "per_event" | "per_day";
  quantity: number;
  unitContribution: number;
  lineFull: number;
  category: string | null;
  requiresElectricity: boolean;
  followUpAnswer: string | null;
}

// True when the request includes at least one item that needs power
// and doesn't include a battery/generator to run it on.
function needsBatteryGeneratorWarning(lines: Line[]): boolean {
  const anyRequires = lines.some((l) => l.requiresElectricity);
  if (!anyRequires) return false;
  const hasGenerator = lines.some((l) => {
    const name = l.name.toLowerCase();
    const slug = l.slug.toLowerCase();
    return (
      slug.includes("generator") ||
      name.includes("battery generator") ||
      name.includes("generator")
    );
  });
  return !hasGenerator;
}

interface Props {
  orgName: string;
  lines: Line[];
  subtotal: number;
  minNoticeHours: number;
  tentativeDisclaimer?: string;
  defaultPickupLocation: string;
  tierLabels: { full: string; mid: string; low: string };
  initialTier: "full" | "mid" | "low";
  turnstileSiteKey: string | null;
}

// Returns "YYYY-MM-DDTHH:MM" for the next full hour in America/New_York,
// then offset by N hours. Used for the pickup/return defaults.
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
  let y = parseInt(get("year"));
  let mo = parseInt(get("month"));
  let d = parseInt(get("day"));
  let h = parseInt(get("hour")) === 24 ? 0 : parseInt(get("hour"));
  // Round up to next hour, then add offset
  h = h + 1 + offsetHours;
  // Normalize using a Date in local — good enough for defaults
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

export function ReserveForm(props: Props) {
  const {
    orgName,
    lines,
    subtotal,
    minNoticeHours,
    tentativeDisclaimer,
    defaultPickupLocation,
    tierLabels,
    initialTier,
    turnstileSiteKey,
  } = props;

  const [state, setState] = useState<State>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [pickupDefault, setPickupDefault] = useState<string>("");
  const [returnDefault, setReturnDefault] = useState<string>("");
  const [tier, setTier] = useState<"full" | "mid" | "low">(initialTier);

  const showElectricityWarning = needsBatteryGeneratorWarning(lines);
  const followUpLines = lines.filter(
    (l) => l.followUpAnswer && l.followUpAnswer.trim() !== ""
  );

  useEffect(() => {
    // Compute defaults on client to avoid SSR/CSR time drift
    const noticeOffset = Math.max(24, minNoticeHours);
    setPickupDefault(nextHourNyDatetimeLocal(noticeOffset));
    setReturnDefault(nextHourNyDatetimeLocal(noticeOffset + 24));
  }, [minNoticeHours]);

  // Turnstile setup
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const w = window as unknown as {
      onGearTurnstileSuccess?: (token: string) => void;
    };
    w.onGearTurnstileSuccess = (token: string) => setTurnstileToken(token);
    return () => {
      w.onGearTurnstileSuccess = undefined;
    };
  }, [turnstileSiteKey]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "idle" });
    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("cf-turnstile-response", turnstileToken);

    startTransition(async () => {
      const result = await submitReservationAction(formData);
      if (result.ok) {
        setState({ kind: "success", humanId: result.humanId });
        // Scroll to top so the confirmation is visible
        if (typeof window !== "undefined") {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      } else {
        setState({ kind: "error", message: result.error });
      }
    });
  }

  if (state.kind === "success") {
    return (
      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold text-emerald-900">
              Request submitted
            </h2>
            <p className="mt-1 text-sm text-emerald-900">
              Your reservation ID is{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono">
                {state.humanId}
              </code>
              . We just sent a confirmation to your email. An organizer will
              review the request within 3 business days.
            </p>
            <p className="mt-3 text-sm text-emerald-900">
              {tentativeDisclaimer ??
                "Your reservation is tentative until an organizer confirms."}
            </p>
            <div className="mt-4">
              <Link
                href="/gear"
                className="inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--color-mip-purple)" }}
              >
                Back to gear library
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
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
          async
          defer
        />
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-8">
        {/* Line summary */}
        <section className="rounded-lg border border-mip-gray-200 bg-white shadow-sm overflow-hidden">
          <header className="px-4 py-3 border-b border-mip-gray-200 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-mip-gray-500">
              Requested items
            </h2>
            <Link
              href="/gear"
              className="text-xs text-mip-gray-500 hover:text-mip-purple hover:underline"
            >
              Edit
            </Link>
          </header>
          <table className="w-full text-sm">
            <thead className="bg-mip-gray-50 text-xs uppercase tracking-wide text-mip-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Item</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
                <th className="text-right px-4 py-2 font-medium">Unit</th>
                <th className="text-right px-4 py-2 font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.slug} className="border-t border-mip-gray-200">
                  <td className="px-4 py-2">
                    <div className="font-medium">{l.name}</div>
                    {l.category && (
                      <div className="text-xs text-mip-gray-500">
                        {l.category}
                      </div>
                    )}
                    {l.followUpAnswer && (
                      <div className="mt-1 text-xs text-mip-gray-600">
                        <span className="text-mip-gray-500">Note: </span>
                        {l.followUpAnswer}
                      </div>
                    )}
                  </td>
                  <td className="text-right px-4 py-2 tabular-nums">
                    {l.quantity}
                  </td>
                  <td className="text-right px-4 py-2 tabular-nums text-mip-gray-700">
                    ${l.unitContribution.toFixed(2)}
                    <span className="text-xs text-mip-gray-500">
                      /{l.unit === "per_day" ? "day" : "event"}
                    </span>
                  </td>
                  <td className="text-right px-4 py-2 tabular-nums font-medium">
                    ${l.lineFull.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-mip-gray-50">
              <tr className="border-t border-mip-gray-200">
                <td colSpan={3} className="text-right px-4 py-2 text-mip-gray-700">
                  Subtotal (suggested)
                </td>
                <td className="text-right px-4 py-2 tabular-nums font-semibold">
                  ${subtotal.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        {/* Hidden inputs so the server action receives follow-up answers */}
        {followUpLines.map((l) => (
          <input
            key={l.slug}
            type="hidden"
            name={`follow_up_answer__${l.slug}`}
            value={l.followUpAnswer ?? ""}
          />
        ))}

        {showElectricityWarning && (
          <div
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-semibold">Heads up — you may need power</p>
                <p className="mt-1 leading-relaxed">
                  Your request includes gear that requires electricity to
                  operate but you didn’t request a battery generator. If
                  you’re planning on using this gear in a location without
                  access to power, consider{" "}
                  <Link
                    href="/gear"
                    className="underline hover:text-amber-950"
                  >
                    adding a battery generator
                  </Link>{" "}
                  to your request.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Requester */}
        <Section title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Your name *"
              name="requester_name"
              required
              maxLength={120}
            />
            <TextField
              label="Email *"
              name="requester_email"
              type="email"
              required
              maxLength={255}
            />
            <TextField
              label="Phone (optional)"
              name="requester_phone"
              type="tel"
              maxLength={40}
            />
            <TextField
              label="Organization (optional)"
              name="organization"
              maxLength={200}
              placeholder="e.g. Popular Democracy, DC Justice Lab…"
            />
          </div>

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
              How would you describe your organization? *
            </legend>
            <div className="space-y-2">
              {(["full", "mid", "low"] as const).map((k) => (
                <label
                  key={k}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer text-sm ${
                    tier === k
                      ? "border-mip-purple bg-mip-purple/5"
                      : "border-mip-gray-300 bg-white hover:bg-mip-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="org_tier"
                    value={k}
                    checked={tier === k}
                    onChange={() => setTier(k)}
                    className="mt-1"
                  />
                  <span>{tierLabels[k]}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-mip-gray-500">
              This adjusts the suggested contribution. It's honor-system —
              you can always pay less (or nothing).
            </p>
          </fieldset>
        </Section>

        {/* Event */}
        <Section title="About your event">
          <TextArea
            label="What's the event? *"
            name="event_description"
            required
            rows={3}
            maxLength={2000}
            placeholder="A quick description helps us prioritize and confirm availability."
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Pickup date & time *"
              name="pickup_at"
              type="datetime-local"
              required
              defaultValue={pickupDefault}
            />
            <TextField
              label="Return date & time *"
              name="return_at"
              type="datetime-local"
              required
              defaultValue={returnDefault}
            />
          </div>
          <p className="mt-1 text-xs text-mip-gray-500">
            Times are Eastern (America/New_York). We need at least{" "}
            <strong>{minNoticeHours} hours</strong> of notice.
          </p>

          <div className="mt-4">
            <TextField
              label="Pickup location"
              name="pickup_location"
              defaultValue={defaultPickupLocation}
              placeholder="If different from the default"
            />
            <p className="mt-2 text-xs text-mip-gray-500">
              The name and phone you gave above are what we'll use to
              reach you on-site — no separate contact needed.
            </p>
          </div>
        </Section>

        {/* Confirm */}
        <Section title="One last thing">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="acknowledged_tentative"
              value="true"
              required
              className="mt-1"
            />
            <span>
              I understand this request is <strong>tentative</strong> until an
              organizer confirms. *
            </span>
          </label>
          {tentativeDisclaimer && (
            <p className="mt-2 text-xs text-mip-gray-500 leading-relaxed">
              {tentativeDisclaimer}
            </p>
          )}

          {turnstileSiteKey && (
            <div className="mt-4">
              <div
                className="cf-turnstile"
                data-sitekey={turnstileSiteKey}
                data-callback="onGearTurnstileSuccess"
              />
            </div>
          )}
        </Section>

        {/* Hidden cart payload */}
        <input
          type="hidden"
          name="cart"
          value={lines.map((l) => `${l.slug}:${l.quantity}`).join(",")}
        />

        {state.kind === "error" && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>{state.message}</div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-mip-gray-500 max-w-md">
            By submitting, you agree to give {orgName} organizers a way to
            reach you about this request. We don't share your info.
          </p>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
            style={{ backgroundColor: "var(--color-mip-purple)" }}
          >
            {isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </span>
            ) : (
              "Submit reservation request"
            )}
          </button>
        </div>
      </form>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-mip-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-mip-gray-500 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function TextField({
  label,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
        {label}
      </div>
      <input
        {...rest}
        className="w-full rounded-md border border-mip-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
      />
    </label>
  );
}

function TextArea({
  label,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-mip-gray-500">
        {label}
      </div>
      <textarea
        {...rest}
        className="w-full rounded-md border border-mip-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-mip-purple/40"
      />
    </label>
  );
}
