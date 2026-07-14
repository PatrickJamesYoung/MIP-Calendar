"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import Script from "next/script";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { ACCESSIBILITY_LABELS } from "@/lib/types";
import type { AccessibilityFeature } from "@/lib/types";
import { submitEventAction } from "./actions";

interface EventType {
  id: string;
  name: string;
}

interface Props {
  eventTypes: EventType[];
  turnstileSiteKey: string | null;
}

// Compute the next hour in America/New_York, formatted for <input type="datetime-local">.
// e.g. current NY time 2:38 PM → returns "2026-07-14T15:00".
function nextHourNyDatetimeLocal(offsetHours = 1): string {
  const now = new Date();
  // Get the current wall-clock time in New_York as parts
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
  // Round up to next hour, then add offset
  let targetH = h + offsetHours;
  let targetD = d;
  let targetMo = mo;
  let targetY = y;
  if (targetH >= 24) {
    targetH -= 24;
    // day rollover: construct a date and add a day
    const roll = new Date(Date.UTC(y, mo - 1, d + 1));
    targetY = roll.getUTCFullYear();
    targetMo = roll.getUTCMonth() + 1;
    targetD = roll.getUTCDate();
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${targetY}-${pad(targetMo)}-${pad(targetD)}T${pad(targetH)}:00`;
}

// Cloudflare Turnstile global
declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, opts: {
        sitekey: string;
        callback: (token: string) => void;
        "error-callback"?: () => void;
        "expired-callback"?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

const ACCESSIBILITY_KEYS: AccessibilityFeature[] = [
  "physical_access",
  "asl",
  "captioning",
  "spanish",
  "childcare",
  "elder_seating",
  "other",
];

export function SubmitForm({ eventTypes, turnstileSiteKey }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<{ eventTitle: string } | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Image upload state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Datetime defaults: start=next hour (+1 from current), end=hour after that (+2)
  const [startDefault, setStartDefault] = useState<string>("");
  const [endDefault, setEndDefault] = useState<string>("");
  useEffect(() => {
    setStartDefault(nextHourNyDatetimeLocal(1));
    setEndDefault(nextHourNyDatetimeLocal(2));
  }, []);

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_IMAGE_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImageError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(f.type)) {
      setImageError("Unsupported file type. Please upload JPG, PNG, WebP, or GIF.");
      setImageFile(null);
      setImagePreview(null);
      e.target.value = "";
      return;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      setImageError(
        `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max size is 5 MB.`
      );
      setImageFile(null);
      setImagePreview(null);
      e.target.value = "";
      return;
    }
    setImageFile(f);
    const url = URL.createObjectURL(f);
    setImagePreview(url);
  }

  // Render Turnstile widget when script loads
  useEffect(() => {
    if (!turnstileSiteKey || !turnstileRef.current) return;
    const tryRender = () => {
      if (window.turnstile && turnstileRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => setTurnstileToken(""),
        });
      }
    };
    tryRender();
    const interval = setInterval(tryRender, 300);
    return () => clearInterval(interval);
  }, [turnstileSiteKey]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(e.currentTarget);
    if (turnstileToken) formData.set("turnstile_token", turnstileToken);
    if (imageFile) {
      formData.set("image_file", imageFile);
    } else {
      formData.delete("image_file");
    }
    const eventTitle = (formData.get("title") as string) || "your event";

    startTransition(async () => {
      const result = await submitEventAction(formData);
      if (result.ok) {
        setSuccess({ eventTitle });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setError(result.error);
        setFieldErrors(result.fields ?? {});
        // Reset captcha so a new token is issued
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
          setTurnstileToken("");
        }
      }
    });
  }

  if (success) {
    return (
      <div className="mt-8">
        <div
          className="flex items-start gap-3 p-6 border border-green-200 bg-green-50 text-green-900"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-lg">Thanks — we got it.</div>
            <p className="mt-2 text-sm leading-relaxed">
              We received your submission for{" "}
              <strong>{success.eventTitle}</strong>. Check your inbox for a
              confirmation email. A calendar admin will review within 3 business
              days.
            </p>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="px-4 py-2 mip-button-text border border-mip-gray-300 hover:border-mip-purple transition-colors"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            Back to calendar
          </Link>
          <button
            onClick={() => setSuccess(null)}
            className="px-4 py-2 mip-button-text"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            Submit another
          </button>
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
        />
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-8">
        {error && (
          <div
            className="flex items-start gap-2 p-3 text-sm bg-red-50 border border-red-200 text-red-800"
            style={{ borderRadius: "var(--radius-button)" }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {/* Section: About you */}
        <Section title="About you">
          <Field label="Your name" required error={fieldErrors.submitter_name}>
            <input
              name="submitter_name"
              required
              maxLength={120}
              className="mip-input"
            />
          </Field>
          <Field label="Email" required error={fieldErrors.submitter_email}>
            <input
              type="email"
              name="submitter_email"
              required
              className="mip-input"
            />
          </Field>
          <Field label="Phone (optional)" error={fieldErrors.submitter_phone}>
            <input type="tel" name="submitter_phone" className="mip-input" />
          </Field>
        </Section>

        {/* Section: Event details */}
        <Section title="Event details">
          <Field label="Event title" required error={fieldErrors.title}>
            <input
              name="title"
              required
              minLength={3}
              maxLength={200}
              className="mip-input"
            />
          </Field>

          <Field label="Description" hint="You can paste HTML or plain text" error={fieldErrors.description}>
            <textarea
              name="description"
              rows={5}
              maxLength={5000}
              className="mip-input"
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-4">
            <Field
              label="Starts"
              required
              error={fieldErrors.starts_at_local}
              hint="Eastern time — you can type or use the picker"
            >
              <input
                type="datetime-local"
                name="starts_at_local"
                required
                step={300}
                defaultValue={startDefault}
                key={startDefault}
                className="mip-input"
              />
            </Field>
            <Field label="Ends (optional)" error={fieldErrors.ends_at_local}>
              <input
                type="datetime-local"
                name="ends_at_local"
                step={300}
                defaultValue={endDefault}
                key={endDefault}
                className="mip-input"
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="all_day" value="on" />
            All-day event
          </label>
        </Section>

        {/* Section: Where */}
        <Section title="Where">
          <Field label="Location type" error={fieldErrors.location_type}>
            <select name="location_type" className="mip-input" defaultValue="">
              <option value="">Choose one…</option>
              <option value="in_person">In person</option>
              <option value="online">Online</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </Field>
          <Field
            label="Location or link"
            hint="Physical address, meeting link, or both"
            error={fieldErrors.location_text}
          >
            <input name="location_text" maxLength={500} className="mip-input" />
          </Field>
        </Section>

        {/* Section: Categorization */}
        <Section title="Categorization">
          <Field label="Event type (optional)">
            <select
              name="event_type_id"
              className="mip-input"
              defaultValue=""
            >
              <option value="">Choose one…</option>
              {eventTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* Section: More info */}
        <Section title="More info (optional)">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Host organization" error={fieldErrors.host_org}>
              <input name="host_org" maxLength={200} className="mip-input" />
            </Field>
            <Field label="Cost" hint="e.g. Free, $10, sliding scale" error={fieldErrors.cost}>
              <input name="cost" maxLength={200} className="mip-input" />
            </Field>
          </div>
          <Field label="RSVP or event link" error={fieldErrors.web_link}>
            <input
              type="url"
              name="web_link"
              placeholder="https://…"
              className="mip-input"
            />
          </Field>
          <Field
            label="Event image"
            hint="JPG, PNG, WebP, or GIF. Max 5 MB."
            error={fieldErrors.image_file}
          >
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImageChange}
              className="block text-sm mip-input-file"
            />
            {imageError && (
              <div className="mt-2 text-sm text-red-700 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" /> {imageError}
              </div>
            )}
            {imagePreview && (
              <div className="mt-3">
                <div className="text-xs uppercase tracking-wider mip-caption-text mb-2">
                  Preview
                </div>
                <img
                  src={imagePreview}
                  alt="Event image preview"
                  className="max-w-xs max-h-48 border border-mip-gray-200"
                  style={{ borderRadius: "var(--radius-button)" }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                    setImageError(null);
                  }}
                  className="mt-2 text-xs text-mip-purple hover:underline"
                >
                  Remove
                </button>
              </div>
            )}
          </Field>
          <Field
            label="Or paste an image URL (optional)"
            hint="If you already have your flyer hosted somewhere"
            error={fieldErrors.image_url}
          >
            <input
              type="url"
              name="image_url"
              placeholder="https://…"
              className="mip-input"
            />
          </Field>

          <fieldset>
            <legend className="mip-input-label mb-2">Accessibility features</legend>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {ACCESSIBILITY_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm text-mip-gray-900"
                >
                  <input type="checkbox" name="accessibility" value={key} />
                  {ACCESSIBILITY_LABELS[key]}
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        {/* Honeypot — hidden from humans via CSS + aria */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", top: "-9999px" }}
        >
          <label>
            Leave this blank
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

        {/* Turnstile */}
        {turnstileSiteKey ? (
          <div ref={turnstileRef} />
        ) : (
          <p className="text-xs text-mip-gray-500 italic">
            (Captcha not configured on this environment — submissions still work.)
          </p>
        )}

        <div className="pt-4 border-t border-mip-gray-200 flex items-center justify-between gap-4">
          <p className="text-xs text-mip-gray-500 flex-1">
            By submitting, you agree that this event is a good faith
            contribution to the DC-area movement calendar.
          </p>
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 px-6 py-2.5 mip-button-text disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-mip-purple)",
              color: "var(--color-mip-white)",
              borderRadius: "var(--radius-button)",
            }}
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            Submit event
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
    <section className="space-y-4">
      <h2
        className="mip-nav-text pb-2 border-b border-mip-gray-200"
        style={{ color: "var(--color-mip-purple)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mip-input-label block mb-1">
        {label}
        {required && <span className="text-red-600 ml-1">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-mip-gray-500">{hint}</p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
