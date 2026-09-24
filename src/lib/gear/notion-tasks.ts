/**
 * Notion task automation for gear requests.
 *
 * On a new request, three tasks are created in Patrick's Tasks Tracker:
 *   Confirm <request>        due 2 days after the request came in
 *   Prep <request>           due 1 day before pickup
 *   Send followup for <req>  due 2 days after return
 *
 * The Confirm task is marked Done when the request is set to Approved,
 * and the follow-up task when a follow-up email is sent successfully.
 * Dates are calendar days in America/New_York.
 *
 * All of this is best-effort: failures are logged to gear_activity and
 * never block the request or the admin action.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { completeNotionTask, createNotionTask } from "@/lib/notion/tasks";

const ADMIN_BASE = "https://app.movementinfrastructureproject.org/admin/gear";

type Supabase = ReturnType<typeof createAdminClient>;

/** ISO instant -> YYYY-MM-DD in Eastern time. */
function etDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Add whole days to a YYYY-MM-DD date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function log(supabase: Supabase, reservationId: string, action: string, detail: Record<string, unknown>) {
  await supabase.from("gear_activity").insert({
    reservation_id: reservationId,
    actor_email: null,
    action,
    detail,
  });
}

export async function createGearRequestTasks(r: {
  id: string;
  human_id: string;
  requester_name: string;
  organization: string | null;
  pickup_at: string;
  return_at: string;
  created_at?: string;
}): Promise<void> {
  const supabase = createAdminClient();
  try {
    const label = `${r.human_id} (${r.organization?.trim() || r.requester_name.trim()})`;
    const link = `${ADMIN_BASE}/${r.human_id}`;
    const received = etDate(r.created_at ?? new Date());

    const [confirm, prep, followup] = await Promise.all([
      createNotionTask({ name: `Confirm ${label}`, dueDate: addDays(received, 2), link }),
      createNotionTask({ name: `Prep ${label}`, dueDate: addDays(etDate(r.pickup_at), -1), link }),
      createNotionTask({ name: `Send followup for ${label}`, dueDate: addDays(etDate(r.return_at), 2), link }),
    ]);

    await supabase
      .from("gear_reservations")
      .update({
        notion_confirm_task_id: confirm.ok ? confirm.value : null,
        notion_prep_task_id: prep.ok ? prep.value : null,
        notion_followup_task_id: followup.ok ? followup.value : null,
      })
      .eq("id", r.id);

    const errors = [confirm, prep, followup].flatMap((x) => (x.ok ? [] : [x.error]));
    await log(supabase, r.id, errors.length ? "notion_tasks_failed" : "notion_tasks_created", {
      created: 3 - errors.length,
      ...(errors.length ? { errors } : {}),
    });
  } catch (e) {
    console.error("[gear-notion] create tasks threw:", e);
  }
}

export async function completeGearRequestTask(
  reservationId: string,
  kind: "confirm" | "followup"
): Promise<void> {
  const supabase = createAdminClient();
  try {
    const column = kind === "confirm" ? "notion_confirm_task_id" : "notion_followup_task_id";
    const { data } = await supabase
      .from("gear_reservations")
      .select(column)
      .eq("id", reservationId)
      .maybeSingle();
    const pageId = (data as Record<string, string | null> | null)?.[column];
    if (!pageId) return; // request predates this feature, or task creation failed

    const res = await completeNotionTask(pageId);
    await log(supabase, reservationId, res.ok ? "notion_task_completed" : "notion_task_complete_failed", {
      task: kind,
      ...(res.ok ? {} : { error: res.error }),
    });
  } catch (e) {
    console.error("[gear-notion] complete task threw:", e);
  }
}
