"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  saveSpaceSettings,
  INITIAL_SAVE_STATE,
  type SaveSpaceSettingsState,
} from "./actions";

// Client wrapper that owns the form + save button + a status banner
// driven by the server action's returned state. Feedback stays on the
// same page (no toasts, no query strings) and re-appears on every save.
export function SaveSettingsForm({ children }: { children: React.ReactNode }) {
  const [state, formAction] = useActionState<SaveSpaceSettingsState, FormData>(
    saveSpaceSettings,
    INITIAL_SAVE_STATE
  );

  return (
    <form action={formAction} className="space-y-6">
      {children}
      <SaveBanner state={state} />
      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-neutral-800 disabled:opacity-60"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

function SaveBanner({ state }: { state: SaveSpaceSettingsState }) {
  // savedAt === 0 means we haven't submitted yet.
  if (state.savedAt === 0) return null;
  if (state.ok) {
    return (
      <div
        role="status"
        aria-live="polite"
        // key on savedAt so the banner re-mounts on each save even if the
        // text is identical, making the confirmation feel fresh.
        key={state.savedAt}
        className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{state.message}</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      key={state.savedAt}
      className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 whitespace-pre-line"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{state.message}</span>
    </div>
  );
}
