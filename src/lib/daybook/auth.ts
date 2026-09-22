/**
 * Shared bearer-token guard for /api/daybook/* routes.
 * Uses the same DAYBOOK_BEARER_TOKEN env var passed by GitHub Actions.
 */

import { NextResponse } from "next/server";

export function checkBearer(req: Request): NextResponse | null {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.DAYBOOK_BEARER_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
