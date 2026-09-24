/**
 * Minimal Notion REST client for Patrick's Tasks Tracker.
 *
 * Env:
 *   NOTION_TOKEN               internal integration secret (required;
 *                              the tracker database must be shared with it)
 *   NOTION_TASKS_DATABASE_ID   defaults to Patrick's Tasks Tracker
 *   NOTION_TASKS_ASSIGNEE_ID   defaults to Patrick Young, so tasks show
 *                              in the "My Tasks" view (filtered on Assignee)
 *
 * Every function is best-effort: it returns { ok, error } and never
 * throws, so a Notion outage can't break a gear request or admin action.
 */

const NOTION_VERSION = "2022-06-28";
const DEFAULT_DATABASE_ID = "33abb28377a580179a4ae177f153e41d";
const DEFAULT_ASSIGNEE_ID = "25cd872b-594c-81a0-b906-000219bcff88";

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

async function notion(path: string, init: { method: string; body: unknown }): Promise<Result<{ id: string }>> {
  const token = process.env.NOTION_TOKEN;
  if (!token) return { ok: false, error: "NOTION_TOKEN not configured" };
  try {
    const res = await fetch(`https://api.notion.com/v1${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(init.body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `Notion ${res.status}: ${json.message ?? "unknown error"}` };
    return { ok: true, value: { id: json.id ?? "" } };
  } catch (e) {
    return { ok: false, error: `Notion request failed: ${(e as Error).message}` };
  }
}

/** Create a task. `dueDate` is a date-only string, YYYY-MM-DD. */
export async function createNotionTask(args: {
  name: string;
  dueDate: string;
  link?: string;
}): Promise<Result<string>> {
  const properties: Record<string, unknown> = {
    "Task name": { title: [{ text: { content: args.name.slice(0, 1900) } }] },
    "Due date": { date: { start: args.dueDate } },
    Status: { status: { name: "Not started" } },
    Assignee: {
      people: [{ id: process.env.NOTION_TASKS_ASSIGNEE_ID || DEFAULT_ASSIGNEE_ID }],
    },
  };
  if (args.link) properties.Link = { url: args.link };

  const res = await notion("/pages", {
    method: "POST",
    body: {
      parent: { database_id: process.env.NOTION_TASKS_DATABASE_ID || DEFAULT_DATABASE_ID },
      properties,
    },
  });
  return res.ok ? { ok: true, value: res.value.id } : res;
}

/** Set a task's Status to Done. */
export async function completeNotionTask(pageId: string): Promise<Result> {
  const res = await notion(`/pages/${pageId}`, {
    method: "PATCH",
    body: { properties: { Status: { status: { name: "Done" } } } },
  });
  return res.ok ? { ok: true, value: undefined } : res;
}
