"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { WikiMarkdown } from "@/components/admin/wiki/markdown";
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
 * - Body has a Write / Preview toggle. Preview uses the same server renderer
 *   (WikiMarkdown) so what you see is what saves.
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
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");

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

      {/* Body: write/preview tabs */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="block text-xs font-medium uppercase tracking-wide text-mip-gray-500">
            Body — Markdown, GitHub-flavored
          </label>
          <div className="flex items-center gap-1">
            <TabButton
              active={tab === "write"}
              onClick={() => setTab("write")}
              icon={<Pencil className="w-3.5 h-3.5" />}
              label="Write"
            />
            <TabButton
              active={tab === "preview"}
              onClick={() => setTab("preview")}
              icon={<Eye className="w-3.5 h-3.5" />}
              label="Preview"
            />
          </div>
        </div>

        {tab === "write" ? (
          <textarea
            name="body_md"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            placeholder={"# Heading\n\nWrite your page in Markdown."}
            className="w-full border border-mip-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:border-mip-purple"
            style={{ borderRadius: "var(--radius-button)", minHeight: "24rem" }}
          />
        ) : (
          <>
            {/* Preview pane still submits the body via a hidden field. */}
            <input type="hidden" name="body_md" value={body} />
            <div
              className="border border-mip-gray-200 p-4 bg-white"
              style={{ borderRadius: "var(--radius-button)", minHeight: "24rem" }}
            >
              <WikiMarkdown source={body} />
            </div>
          </>
        )}
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

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 mip-button-text text-xs transition-colors ${
        active
          ? "bg-mip-purple text-mip-white"
          : "text-mip-gray-700 hover:bg-mip-gray-100"
      }`}
      style={{ borderRadius: "var(--radius-button)" }}
    >
      {icon}
      {label}
    </button>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-rose-700">{message}</p>;
}
