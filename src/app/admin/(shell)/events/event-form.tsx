"use client";

import Link from "next/link";
import { useTransition } from "react";
import type {
  CalendarEvent,
  EventType,
  OverlayCalendar,
  AccessibilityFeature,
} from "@/lib/types";
import { ACCESSIBILITY_LABELS } from "@/lib/types";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  event?: Partial<CalendarEvent>;
  overlays: OverlayCalendar[];
  eventTypes: EventType[];
  action: (formData: FormData) => Promise<void>;
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Format as YYYY-MM-DDTHH:mm in the user's browser TZ.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function EventForm({ mode, event = {}, overlays, eventTypes, action }: Props) {
  const [pending, start] = useTransition();

  const accessibility = new Set<AccessibilityFeature>(event.accessibility ?? []);

  function submit(formData: FormData) {
    start(() => action(formData));
  }

  return (
    <form action={submit} className="space-y-6 max-w-3xl">
      <Field label="Title" required>
        <input
          name="title"
          required
          maxLength={300}
          defaultValue={event.title ?? ""}
          className="input"
        />
      </Field>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Overlay calendar">
          <select
            name="overlay_calendar_id"
            defaultValue={event.overlay_calendar_id ?? ""}
            className="input"
          >
            <option value="">— none —</option>
            {overlays.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Event type">
          <select
            name="event_type_id"
            defaultValue={event.event_type_id ?? ""}
            className="input"
          >
            <option value="">— none —</option>
            {eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Starts" required hint="Your local time">
          <input
            name="starts_at"
            type="datetime-local"
            required
            defaultValue={toLocalInput(event.starts_at)}
            className="input"
          />
        </Field>
        <Field label="Ends" hint="Optional">
          <input
            name="ends_at"
            type="datetime-local"
            defaultValue={toLocalInput(event.ends_at)}
            className="input"
          />
        </Field>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="all_day"
            defaultChecked={event.all_day ?? false}
          />
          All day
        </label>
        <input type="hidden" name="timezone" value={event.timezone ?? "America/New_York"} />
        <span className="text-xs text-mip-gray-500">
          Timezone: America/New_York
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Location type">
          <select
            name="location_type"
            defaultValue={event.location_type ?? ""}
            className="input"
          >
            <option value="">— unspecified —</option>
            <option value="in_person">In person</option>
            <option value="online">Online</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </Field>
        <Field label="Cost">
          <input
            name="cost"
            defaultValue={event.cost ?? ""}
            placeholder="Free / $10 sliding scale"
            className="input"
          />
        </Field>
      </div>

      <Field label="Location">
        <input
          name="location_text"
          defaultValue={event.location_text ?? ""}
          placeholder="33 Grant Circle NW, Washington DC"
          className="input"
        />
      </Field>

      <Field label="Host organization">
        <input
          name="host_org"
          defaultValue={event.host_org ?? ""}
          className="input"
        />
      </Field>

      <Field label="Web link" hint="Registration or info URL">
        <input
          name="web_link"
          type="url"
          defaultValue={event.web_link ?? ""}
          placeholder="https://…"
          className="input"
        />
      </Field>

      <Field label="Image URL" hint="Shown on cards + detail page">
        <input
          name="image_url"
          type="url"
          defaultValue={event.image_url ?? ""}
          placeholder="https://…"
          className="input"
        />
      </Field>

      <Field label="Description" hint="Plain text for now; rich text coming soon">
        <textarea
          name="description"
          rows={6}
          defaultValue={event.description ?? ""}
          className="input font-mono text-xs"
        />
      </Field>

      <Field label="Accessibility features">
        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(ACCESSIBILITY_LABELS) as [
            AccessibilityFeature,
            string
          ][]).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                name="accessibility"
                value={value}
                defaultChecked={accessibility.has(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>

      <div className="border-t border-mip-gray-200 pt-6 space-y-4">
        <h3 className="mip-heading text-base" style={{ color: "var(--color-mip-purple)" }}>
          Featured & Status
        </h3>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            name="is_featured"
            defaultChecked={event.is_featured ?? false}
          />
          Feature in the priority bar
        </label>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Featured until" hint="Auto-unfeature after this date">
            <input
              name="featured_until"
              type="datetime-local"
              defaultValue={toLocalInput(event.featured_until)}
              className="input"
            />
          </Field>
          <Field label="Featured sort order" hint="Lower shows first">
            <input
              name="featured_sort_order"
              type="number"
              defaultValue={event.featured_sort_order ?? ""}
              className="input"
            />
          </Field>
        </div>

        <Field label="Status">
          <select name="status" defaultValue={event.status ?? "published"} className="input">
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-mip-gray-200">
        <button
          type="submit"
          disabled={pending}
          className="px-6 py-2.5 mip-button-text disabled:opacity-50"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          {pending ? "Saving…" : mode === "create" ? "Create Event" : "Save Changes"}
        </button>
        <Link
          href="/admin"
          className="px-4 py-2 mip-button-text border border-mip-gray-300 hover:border-mip-purple"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          Cancel
        </Link>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--color-mip-gray-300);
          border-radius: var(--radius-button);
          font-size: 0.875rem;
          background: white;
          outline: none;
        }
        .input:focus {
          border-color: var(--color-mip-purple);
        }
      `}</style>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-mip-gray-700 mb-1.5">
        {label}
        {required && <span style={{ color: "#c1121f" }}> *</span>}
        {hint && <span className="normal-case font-normal text-mip-gray-500 tracking-normal ml-2">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
