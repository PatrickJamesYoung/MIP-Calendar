/**
 * Shared wrapper for admin server actions.
 *
 * Every admin action in `src/app/admin/(shell)/**\/actions.ts` has the same
 * boilerplate:
 *
 *   export async function doThing(formData: FormData) {
 *     await requireAdmin();
 *     const supabase = createAdminClient();
 *     // ...work...
 *     if (error) throw new Error(`Failed to X: ${error.message}`);
 *     revalidatePath("/admin/...");
 *   }
 *
 * `adminAction` collapses the auth + admin-client + revalidate + error-shape
 * concerns into a wrapper so each action file only carries domain logic.
 * It also normalizes the return shape so form callers can render errors
 * without try/catch: every wrapped action returns `AdminActionResult<T>`.
 *
 * This is the server-action analog of `withIngestAuth` (src/lib/ingest/handler.ts).
 *
 * ## Usage
 *
 *   // Simple mutation from a <form action={...}>
 *   export const deleteGearItem = adminAction(
 *     async ({ supabase }, formData: FormData) => {
 *       const id = requiredString(formData, "id", "id");
 *       const { error } = await supabase.from("gear_items").delete().eq("id", id);
 *       if (error) throw new AdminActionError("internal", "Failed to delete item.");
 *     },
 *     { revalidate: "/admin/gear/catalog" },
 *   );
 *
 *   // Typed args + audit trail
 *   export const updateReservationStatus = adminAction<
 *     { reservationId: string; status: Status },
 *     void
 *   >(
 *     async ({ supabase }, { reservationId, status }) => {
 *       const { error } = await supabase
 *         .from("gear_reservations")
 *         .update({ status })
 *         .eq("id", reservationId);
 *       if (error) throw new AdminActionError("internal", "Failed to update status.");
 *     },
 *     {
 *       revalidate: (_result, { reservationId }) => `/admin/gear/${reservationId}`,
 *       audit: (_result, args) => ({
 *         action: "reservation.status_change",
 *         entityType: "gear_reservation",
 *         entityId: args.reservationId,
 *       }),
 *     },
 *   );
 *
 * ## Auth behaviour
 *
 * `requireAdmin()` calls `redirect()` when there's no session. That throws
 * a Next.js internal redirect error which we intentionally re-throw so the
 * user lands on `/admin/login` instead of seeing a silent `{ ok: false }`.
 * Every other thrown error is caught and converted to an `AdminActionResult`.
 *
 * ## What this does NOT do
 *
 * - Does not validate input schemas. Actions still parse their own FormData
 *   or typed args. Consider layering Zod on top of this later.
 * - Does not know about `gear_activity` — that table is a domain event
 *   feed with reservation-scoped columns the wrapper can't infer. Call
 *   it explicitly from the handler when needed.
 * - Does not wrap client-visible file uploads (e.g. `uploadGearImageAction`)
 *   because those already return their own domain-specific result shape.
 */

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireAdmin, type AdminUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdminActionErrorCode =
  | "unauthorized"
  | "validation"
  | "not_found"
  | "conflict"
  | "internal";

export interface AdminActionContext {
  admin: AdminUser;
  supabase: ReturnType<typeof createAdminClient>;
}

export type AdminActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; code: AdminActionErrorCode; message: string };

/**
 * Thrown from inside a wrapped handler to produce a typed `{ ok: false }`
 * response instead of a generic 500-style error. The `message` is safe to
 * surface in the UI.
 */
export class AdminActionError extends Error {
  code: AdminActionErrorCode;
  constructor(code: AdminActionErrorCode, message: string) {
    super(message);
    this.name = "AdminActionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface AuditSpec {
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: unknown;
}

export interface AdminActionOptions<TArgs, TResult> {
  /**
   * Human-readable label for logs; defaults to the handler function name.
   */
  name?: string;
  /**
   * Path or paths to revalidate after a successful run. Can be static or
   * derived from the result + args.
   */
  revalidate?:
    | string
    | string[]
    | ((result: TResult, args: TArgs) => string | string[] | null | undefined);
  /**
   * Audit-log row written after success. When absent, no audit row is
   * written — reserved for actions that already log to a domain-specific
   * feed (e.g. gear_activity).
   */
  audit?:
    | AuditSpec
    | ((result: TResult, args: TArgs, ctx: AdminActionContext) => AuditSpec | null);
  /**
   * Default error message returned in `{ ok: false, code: "internal", message }`
   * for unexpected exceptions. Defaults to a generic string.
   */
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeAuditRow(
  admin: AdminUser,
  spec: AuditSpec,
): Promise<void> {
  // We use the request-scoped server client (not admin) so RLS still
  // records who did the write via auth.uid(). audit_log inserts are
  // gated by is_admin() in migration 0001, which this admin already is.
  try {
    const supabase = await createClient();
    await supabase.from("audit_log").insert({
      admin_id: admin.id,
      action: spec.action,
      entity_type: spec.entityType,
      entity_id: spec.entityId ?? null,
      diff: (spec.diff ?? null) as never,
    });
  } catch (err) {
    // Never fail the caller because audit logging blew up. Log and move on.
    console.error("[adminAction] audit_log insert failed", err);
  }
}

function toPathArray(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type AdminActionHandler<TArgs, TResult> = (
  ctx: AdminActionContext,
  args: TArgs,
) => Promise<TResult> | TResult;

/**
 * Wrap a server action with admin auth, service-role Supabase client,
 * uniform error shape, revalidation, and optional audit logging.
 */
export function adminAction<TArgs, TResult = void>(
  handler: AdminActionHandler<TArgs, TResult>,
  opts: AdminActionOptions<TArgs, TResult> = {},
): (args: TArgs) => Promise<AdminActionResult<TResult>> {
  const label = opts.name ?? handler.name ?? "adminAction";
  const genericMessage = opts.errorMessage ?? "Something went wrong.";

  return async (args: TArgs): Promise<AdminActionResult<TResult>> => {
    // 1. Auth. Any redirect() throw (unauthenticated) propagates.
    const admin = await requireAdmin();

    // 2. Service-role client for the domain work.
    const supabase = createAdminClient();
    const ctx: AdminActionContext = { admin, supabase };

    // 3. Run the handler; convert throws to typed results.
    let result: TResult;
    try {
      result = await handler(ctx, args);
    } catch (err) {
      // Preserve Next redirects so login flows keep working.
      if (isRedirectError(err)) throw err;

      if (err instanceof AdminActionError) {
        console.error(`[adminAction:${label}] ${err.code}`, err.message);
        return { ok: false, code: err.code, message: err.message };
      }

      const message = err instanceof Error ? err.message : String(err);
      console.error(`[adminAction:${label}] uncaught`, message);
      return { ok: false, code: "internal", message: genericMessage };
    }

    // 4. Best-effort revalidate.
    const revalidateSpec =
      typeof opts.revalidate === "function"
        ? opts.revalidate(result, args)
        : opts.revalidate;
    for (const p of toPathArray(revalidateSpec)) {
      try {
        revalidatePath(p);
      } catch (err) {
        console.error(`[adminAction:${label}] revalidatePath(${p}) failed`, err);
      }
    }

    // 5. Best-effort audit log.
    if (opts.audit) {
      const spec =
        typeof opts.audit === "function" ? opts.audit(result, args, ctx) : opts.audit;
      if (spec) await writeAuditRow(admin, spec);
    }

    return { ok: true, data: result };
  };
}

// ---------------------------------------------------------------------------
// Form-action variant — for classic <form action={...}> callers
// ---------------------------------------------------------------------------

/**
 * Form-action variant of `adminAction`.
 *
 * Existing admin server actions used as `<form action={fn}>` throw on
 * failure and rely on Next's error boundary to render the error. Wrapping
 * them with `adminAction` would silently return `{ ok: false }` and the
 * user would see nothing.
 *
 * `adminFormAction` preserves the throw contract — errors propagate to
 * the caller — while still absorbing the auth + client + revalidate +
 * audit boilerplate. Use this for form actions until (or unless) the
 * form is refactored to read the result.
 *
 * ## Usage
 *
 *   export const createGearItem = adminFormAction(
 *     async ({ supabase }, formData) => {
 *       const name = requiredString(formData, "name", "Name");
 *       const { error } = await supabase.from("gear_items").insert({ name });
 *       if (error) throw new Error(`Failed to create item: ${error.message}`);
 *     },
 *     { revalidate: "/admin/gear/catalog" },
 *   );
 */
export type AdminFormHandler = (
  ctx: AdminActionContext,
  formData: FormData,
) => Promise<void> | void;

export interface AdminFormOptions {
  name?: string;
  revalidate?: string | string[] | ((formData: FormData) => string | string[] | null | undefined);
  audit?: AuditSpec | ((formData: FormData, ctx: AdminActionContext) => AuditSpec | null);
}

export function adminFormAction(
  handler: AdminFormHandler,
  opts: AdminFormOptions = {},
): (formData: FormData) => Promise<void> {
  const label = opts.name ?? handler.name ?? "adminFormAction";

  return async (formData: FormData): Promise<void> => {
    const admin = await requireAdmin();
    const supabase = createAdminClient();
    const ctx: AdminActionContext = { admin, supabase };

    // Handler throws propagate. We only intercept after success for
    // revalidate + audit, and log any secondary failures without hiding
    // the primary outcome.
    await handler(ctx, formData);

    const revalidateSpec =
      typeof opts.revalidate === "function"
        ? opts.revalidate(formData)
        : opts.revalidate;
    for (const p of toPathArray(revalidateSpec)) {
      try {
        revalidatePath(p);
      } catch (err) {
        console.error(`[adminFormAction:${label}] revalidatePath(${p}) failed`, err);
      }
    }

    if (opts.audit) {
      const spec =
        typeof opts.audit === "function" ? opts.audit(formData, ctx) : opts.audit;
      if (spec) await writeAuditRow(admin, spec);
    }
  };
}
