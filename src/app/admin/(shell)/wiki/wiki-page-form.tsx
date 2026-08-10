"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { TiptapEditor } from "@/components/admin/wiki/tiptap-editor";
import { slugify } from "@/lib/wiki/slug";
import type { ActionState } from "./actions";

interface Props {
  mode: "create" | "edit";
  action: (
    prev: ActionState | undefined,
    formData: FormData
  ) => Promise<ActionState>;
  initial?: {
    id: string;
    slug: string;
    title: string;
    summary: string | null;
    body_md: string;
  };
  cancelHref: string;
}

/**
 * Shared form for creating and editing wiki pages.
 *
 * - Slug field auto-derives from the title until the user manually edits it.
 * - Body uses a Tiptap WYSIWYG editor that serializes to HTML into a hidden
 *   body_md field. The DB column name stays for backwards compatibility with
 *   existing markdown rows; the view layer auto-detects the format.
 * - Errors from the server action are shown inline per field.
 */
export function WikiPageForm({ mode, action, initial, cancelHref }: Props) {
  const [state, formAction] = useActionState<ActionState | undefined, FormData>(
    action,
    undefined
  );
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slugRaw, setSlugRaw] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  // Body is owned by the Tiptap editor component below, which serializes
  // itself into a hidden input named body_md. No local state needed here.
  const initialBody = initial?.body_md ?? "";

  // Derived: slug auto-follows the title until the user starts editing it.
  const slug = slugTouched ? slugRaw : slugify(title);

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="space-y-5"
    >
      {initial && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="original_slug" value={initial.slug} />
        </>
      )}

      {state && !state.ok && (
        <div
          className="border border-rose-300 bg-rose-50 text-rose-900 px-3 py-2 text-sm"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          {state.error}
        </div>
      )}

      {/* Title */}
      <div>
        <label
          htmlFor="title"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-mip-gray-500"
        >
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          className="w-full border border-mip-gray-300 px-3 py-2 text-base focus:outline-none focus:border-mip-purple"
          style={{ borderRadius: "var(--radius-button)" }}
        />
        {fieldErrors.title && <FieldError message={fieldErrors.title} />}
      </div>

      {/* Slug */}
      <div>
        <label
          htmlFor="slug"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-mip-gray-500"
        >
          Slug — the URL segment
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-mip-gray-500 font-mono">/admin/wiki/</span>
          <input
            id="slug"
            name="slug"
            type="text"
            value={slug}
            onChange={(e) => {
              setSlugRaw(e.target.value);
              setSlugTouched(true);
            }}
            required
            maxLength={80}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            className="flex-1 border border-mip-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-mip-purple"
            style={{ borderRadius: "var(--radius-button)" }}
          />
        </div>
        <p className="mt-1 text-xs text-mip-gray-500">
          Lowercase letters, numbers, and hyphens only.
        </p>
        {fieldErrors.slug && <FieldError message={fieldErrors.slug} />}
      </div>

      {/* Summary */}
      <div>
        <label
          htmlFor="summary"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-mip-gray-500"
        >
          Summary — optional, shown in the wiki index
        </label>
        <input
          id="summary"
          name="summary"
          type="text"
          value={summary ?? ""}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={500}
          placeholder="One sentence describing this page"
          className="w-full border border-mip-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-mip-purple"
          style={{ borderRadius: "var(--radius-button)" }}
        />
        {fieldErrors.summary && <FieldError message={fieldErrors.summary} />}
      </div>

      {/* Body — Tiptap WYSIWYG. Serializes to HTML into the hidden body_md
          input (the column name stays for backwards compatibility with
          existing markdown rows). */}
      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-mip-gray-500">
          Body
        </label>
        <TiptapEditor
          name="body_md"
          initialHtml={initialBody}
          placeholder="Start writing… Use the toolbar for headings, lists, links, and tables."
        />
        {fieldErrors.body_md && <FieldError message={fieldErrors.body_md} />}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href={cancelHref}
          className="px-4 py-2 mip-button-text text-mip-gray-700 hover:bg-mip-gray-100"
          style={{ borderRadius: "var(--radius-button)" }}
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 mip-button-text disabled:opacity-60"
          style={{
            backgroundColor: "var(--color-mip-purple)",
            color: "var(--color-mip-white)",
            borderRadius: "var(--radius-button)",
          }}
        >
          {isPending
            ? "Saving…"
            : mode === "create"
              ? "Create page"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-rose-700">{message}</p>;
}
