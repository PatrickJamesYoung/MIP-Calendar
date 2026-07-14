/**
 * Bearer-token auth for the /api/ingest/* endpoints.
 *
 * The GitHub Actions runner authenticates with a shared secret set in the
 * INGEST_BEARER_TOKEN env var. Constant-time comparison to avoid timing
 * attacks; requests without a valid token get a 401.
 */

import { timingSafeEqual } from "node:crypto";

export function checkIngestAuth(req: Request): { ok: true } | { ok: false; response: Response } {
  const expected = process.env.INGEST_BEARER_TOKEN;
  if (!expected) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "INGEST_BEARER_TOKEN not configured on server" }),
        { status: 500, headers: { "content-type": "application/json" } }
      ),
    };
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }

  const provided = match[1].trim();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Invalid bearer token" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    };
  }

  return { ok: true };
}
