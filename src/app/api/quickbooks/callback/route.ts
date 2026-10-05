import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentAdmin } from "@/lib/auth";
import { configuration, connection, db, encryptTokens, exchangeToken, rawRequest, withLock } from "@/lib/quickbooks/client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin || admin.role !== "super") return new NextResponse("Super-admin login required", { status: 403 });
  const config = configuration();
  const destination = new URL("/admin/quickbooks", config.redirectUri);
  try {
    const params = request.nextUrl.searchParams;
    const state = params.get("state") || "";
    const cookieStore = await cookies();
    const expected = cookieStore.get("__Host-qbo-state")?.value || "";
    cookieStore.set("__Host-qbo-state", "", {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0,
    });
    if (!/^[a-f0-9]{64}$/.test(state) || expected.length !== state.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(expected)))
      throw new Error("Authorization state did not match. Start again from QuickBooks settings.");
    const hash = createHash("sha256").update(state).digest("hex");
    const { data, error } = await db().from("qbo_oauth_states").delete()
      .eq("state_hash", hash).eq("admin_id", admin.id)
      .gt("expires_at", new Date().toISOString()).select("state_hash").maybeSingle();
    if (error || !data) throw new Error("Authorization expired or was already used. Start again.");
    const realmId = params.get("realmId") || "";
    const code = params.get("code");
    if (params.has("error") || !code || !/^\d{1,30}$/.test(realmId))
      throw new Error("QuickBooks connection was not authorized.");
    await withLock("oauth", async () => {
      const old = await connection();
      if (old && old.realm_id !== realmId)
        throw new Error("A different company is already linked. Reconnect the same MIP company.");
      const tokens = await exchangeToken(new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: config.redirectUri,
      }));
      const response = await rawRequest({ realm_id: realmId, environment: config.environment },
        tokens.access_token, `companyinfo/${realmId}`);
      const { CompanyInfo } = await response.json();
      if (!CompanyInfo?.CompanyName || CompanyInfo.Country !== "US")
        throw new Error("This integration requires the US MIP QuickBooks Online company.");
      const { error: saveError } = await db().from("qbo_connection").upsert({
        id: true, realm_id: realmId, environment: config.environment,
        company_name: CompanyInfo.CompanyName, tokens_encrypted: encryptTokens(tokens),
        access_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
        // First connection remains disabled until company and mappings are confirmed.
        enabled: old?.enabled ?? false,
        auto_send_disabled_confirmed: old?.auto_send_disabled_confirmed ?? false,
        gear_item_id: old?.gear_item_id ?? null, spaces_item_id: old?.spaces_item_id ?? null,
        gear_tax_code: old?.gear_tax_code ?? null, spaces_tax_code: old?.spaces_tax_code ?? null,
      }, { onConflict: "id" });
      if (saveError) throw new Error("Could not store the QuickBooks connection. Start again.");
    });
    destination.searchParams.set("connected", "1");
  } catch (e) {
    destination.searchParams.set("error", (e as Error).message);
  }
  return NextResponse.redirect(destination);
}
