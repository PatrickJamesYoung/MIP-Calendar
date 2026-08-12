/**
 * Shared handler wrapper for `/api/ingest/*` routes.
 *
 * Every ingest endpoint has the same shape:
 *   1. Bearer-token check (checkIngestAuth) — return early on failure.
 *   2. Parse JSON body if present.
 *   3. Do the actual work.
 *   4. Return JSON response.
 *
 * `withIngestAuth` collapses (1) into a wrapper so the route file only
 * carries the domain logic. It also normalizes JSON-parse errors and
 * uncaught exceptions into structured JSON responses instead of the
 * Next.js default HTML error pages.
 *
 * Usage (POST route with typed body):
 *
 *   interface Body { events: RunnerEvent[] }
 *
 *   export const POST = withIngestAuth<Body>(async ({ body }) => {
 *     // body is Body | undefined (undefined when the request has no body)
 *     return Response.json({ ok: true });
 *   });
 *
 * Usage (GET route, no body):
 *
 *   export const GET = withIngestAuth(async () => {
 *     return Response.json({ rows: [...] });
 *   });
 */

import { checkIngestAuth } from "@/lib/ingest/auth";

export interface IngestHandlerContext<TBody = unknown> {
  req: Request;
  /**
   * Parsed JSON body when the request has one. `undefined` for GET
   * requests and for POSTs with an empty body. Callers are responsible
   * for their own schema validation past the "is it an object" gate.
   */
  body: TBody | undefined;
}

export type IngestHandler<TBody = unknown> = (
  ctx: IngestHandlerContext<TBody>
) => Promise<Response> | Response;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Wrap an ingest handler with bearer-token auth + safe JSON parsing.
 *
 * On auth failure, returns the auth helper's 401/500 response verbatim.
 * On unparseable JSON body, returns a 400 with `{ error: "Invalid JSON body" }`.
 * On uncaught exception in the handler, returns a 500 with the message
 * (this surfaces the underlying error string to callers, which is fine
 * for bearer-authed endpoints — the caller is our own GitHub Actions
 * runner, not an anonymous public client).
 */
export function withIngestAuth<TBody = unknown>(
  handler: IngestHandler<TBody>
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const auth = checkIngestAuth(req);
    if (!auth.ok) return auth.response;

    let body: TBody | undefined;
    // GET and DELETE never carry a body; skip parsing.
    if (req.method !== "GET" && req.method !== "DELETE" && req.method !== "HEAD") {
      // A missing body is fine — some POSTs are just triggers.
      const contentType = req.headers.get("content-type") ?? "";
      const hasJsonBody = contentType.includes("application/json");
      if (hasJsonBody) {
        try {
          body = (await req.json()) as TBody;
        } catch {
          return jsonError(400, "Invalid JSON body");
        }
      }
    }

    try {
      return await handler({ req, body });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[ingest] uncaught handler error", message);
      return jsonError(500, message);
    }
  };
}
