"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  saveGearSettings,
  INITIAL_SAVE_STATE,
  type SaveGearSettingsState,
} from "./actions";

// Client wrapper that owns the gear settings form + save button + a
// status banner driven by the server action's returned state.
export function SaveSettingsForm({ children }: { children: React.ReactNode }) {
  const [state, formAction] = useActionState<SaveGearSettingsState, FormData>(
    saveGearSettings,
    INITIAL_SAVE_STATE
  );

  return (
    <form action={formAction} className="space-y-8">
      {children}
      <SaveBanner state={state} />
      <div className="sticky bottom-4 z-10 flex justify-end">
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
      className="inline-flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold text-white shadow-lg disabled:opacity-60"
      style={{ backgroundColor: "var(--color-mip-purple)" }}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {pending ? "Saving…" : "Save all settings"}
    </button>
  );
}

function SaveBanner({ state }: { state: SaveGearSettingsState }) {
  if (state.savedAt === 0) return null;
  if (state.ok) {
    return (
      <div
        role="status"
        aria-live="polite"
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
