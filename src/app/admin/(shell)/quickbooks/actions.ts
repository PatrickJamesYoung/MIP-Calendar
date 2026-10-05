"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth";
import { configuration, connection, db, qbo } from "@/lib/quickbooks/client";
import { idSchema } from "@/lib/quickbooks/model";

export async function connectQuickBooks() {
  const admin = await requireSuperAdmin();
  const c = configuration();
  const state = randomBytes(32).toString("hex");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { error } = await db().from("qbo_oauth_states").insert({
    state_hash: stateHash, admin_id: admin.id,
    expires_at: new Date(Date.now() + 600000).toISOString(),
  });
  if (error) throw new Error("Apply migration 0111 before connecting QuickBooks.");
  (await cookies()).set("__Host-qbo-state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", c.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  redirect(url.toString());
}

export type ItemOption = { Id: string; Name: string; Type: string; Active: boolean };
export async function saveQuickBooksSettings(formData: FormData) {
  await requireSuperAdmin();
  const parsed = z.object({
    realm: idSchema, gearItem: idSchema, spacesItem: idSchema,
    gearTax: z.enum(["NON", "TAX"]), spacesTax: z.enum(["NON", "TAX"]),
    confirm: z.literal("on"), autoSendOff: z.literal("on"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/admin/quickbooks?error=Choose+items+and+tax+treatment+and+confirm+the+MIP+company.");
  const v = parsed.data;
  try {
    const c = await connection();
    if (!c || c.realm_id !== v.realm) throw new Error("Company changed. Reload and confirm the MIP company.");
    for (const id of new Set([v.gearItem, v.spacesItem])) {
      const { Item } = await qbo<{ Item: ItemOption }>(`item/${id}`);
      if (!Item?.Active || !["Service", "NonInventory"].includes(Item.Type))
        throw new Error("Choose active Service or NonInventory items.");
    }
    const { error } = await db().from("qbo_connection").update({
      enabled: true, auto_send_disabled_confirmed: true,
      gear_item_id: v.gearItem, spaces_item_id: v.spacesItem,
      gear_tax_code: v.gearTax, spaces_tax_code: v.spacesTax,
      updated_at: new Date().toISOString(),
    }).eq("id", true).eq("realm_id", v.realm);
    if (error) throw new Error("Could not save QuickBooks settings.");
  } catch (e) {
    redirect(`/admin/quickbooks?error=${encodeURIComponent((e as Error).message)}`);
  }
  revalidatePath("/admin/quickbooks");
  redirect("/admin/quickbooks?saved=1");
}
