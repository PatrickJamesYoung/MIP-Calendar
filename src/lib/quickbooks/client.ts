import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const db = () => createAdminClient();
export type Connection = {
  realm_id: string; environment: "sandbox" | "production"; company_name: string;
  tokens_encrypted: string; access_expires_at: string; enabled: boolean;
  auto_send_disabled_confirmed: boolean;
  gear_item_id: string | null; spaces_item_id: string | null;
  gear_tax_code: string | null; spaces_tax_code: string | null;
};
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
export class QuickBooksError extends Error {
  constructor(message: string, readonly httpStatus: number) { super(message); }
  get rejectedWithoutWrite() { return [400, 401, 403, 404, 422].includes(this.httpStatus); }
}
export function configuration() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const environment = process.env.QBO_ENVIRONMENT;
  if (!clientId || !clientSecret || !redirectUri ||
      !["sandbox", "production"].includes(environment || "")) {
    throw new Error("QuickBooks setup is incomplete. Configure the QBO environment variables.");
  }
  if (!redirectUri.startsWith("https://")) throw new Error("QuickBooks redirect URI must use HTTPS.");
  encryptionKey(); // fail closed before starting authorization
  return { clientId, clientSecret, redirectUri, environment: environment as Connection["environment"] };
}
function encryptionKey() {
  const key = Buffer.from(process.env.QBO_TOKEN_ENCRYPTION_KEY || "", "base64");
  if (key.length !== 32) throw new Error("Set QBO_TOKEN_ENCRYPTION_KEY to a base64-encoded 32-byte key.");
  return key;
}
export function encryptTokens(tokens: Tokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64")).join(".");
}
function decryptTokens(value: string): Tokens {
  const [iv, tag, payload] = value.split(".").map(s => Buffer.from(s, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8"));
}
export async function exchangeToken(params: URLSearchParams): Promise<Tokens> {
  const c = configuration();
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json",
    }, body: params,
  });
  if (!res.ok) throw new Error("QuickBooks authorization failed. Reconnect the MIP company from settings.");
  const value = await res.json() as Tokens;
  if (!value.access_token || !value.refresh_token || !value.expires_in) throw new Error("Invalid QuickBooks token response.");
  return value;
}
export async function connection(): Promise<Connection | null> {
  const { data, error } = await db().from("qbo_connection").select("*").eq("id", true).maybeSingle();
  if (error) throw new Error("QuickBooks database setup is missing or unavailable. Apply migration 0111.");
  if (data && data.environment !== configuration().environment)
    throw new Error("QuickBooks environment differs from the saved connection. Do not share sandbox and production databases.");
  return data as Connection | null;
}
export async function withLock<T>(resource: string, fn: () => Promise<T>): Promise<T> {
  const owner = randomUUID();
  const { data, error } = await db().rpc("qbo_acquire_lock", { p_resource: resource, p_owner: owner });
  if (error || !data) throw new Error("Another invoice or connection operation is running. Wait a moment and try again.");
  try { return await fn(); }
  finally { await db().from("qbo_locks").delete().eq("resource", resource).eq("owner", owner); }
}
async function accessToken(c: Connection): Promise<string> {
  if (Date.parse(c.access_expires_at) > Date.now() + 120000) return decryptTokens(c.tokens_encrypted).access_token;
  return withLock("oauth", async () => {
    const latest = await connection();
    if (!latest || latest.realm_id !== c.realm_id) throw new Error("QuickBooks connection changed. Reload.");
    if (Date.parse(latest.access_expires_at) > Date.now() + 120000) return decryptTokens(latest.tokens_encrypted).access_token;
    const next = await exchangeToken(new URLSearchParams({
      grant_type: "refresh_token", refresh_token: decryptTokens(latest.tokens_encrypted).refresh_token,
    }));
    const { error } = await db().from("qbo_connection").update({
      tokens_encrypted: encryptTokens(next),
      access_expires_at: new Date(Date.now() + next.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", true);
    if (error) throw new Error("Could not save the refreshed QuickBooks connection. Retry before invoicing.");
    return next.access_token;
  });
}
export async function rawRequest(c: Pick<Connection, "realm_id" | "environment">, token: string,
  path: string, body?: unknown, requestId?: string, pdf = false) {
  if (!/^\d+$/.test(c.realm_id)) throw new Error("Invalid QuickBooks company ID.");
  const host = c.environment === "production" ? "quickbooks.api.intuit.com" : "sandbox-quickbooks.api.intuit.com";
  const url = new URL(`https://${host}/v3/company/${c.realm_id}/${path}`);
  url.searchParams.set("minorversion", "75");
  if (requestId) url.searchParams.set("requestid", requestId);
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, Accept: pdf ? "application/pdf" : "application/json",
      "Content-Type": body === null ? "application/octet-stream" : "application/json" },
    ...(body !== undefined ? { body: body === null ? "" : JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    // Do not expose provider payloads, OAuth secrets, or customer data in errors/logs.
    const fault = await res.json().catch(() => ({}));
    const code = fault?.Fault?.Error?.[0]?.code;
    throw new QuickBooksError(`QuickBooks request failed (HTTP ${res.status}${code ? `, code ${String(code).replace(/[^0-9]/g, "")}` : ""}).${res.status === 401 ? " Reconnect from QuickBooks settings." : " No automatic retry was made."}`, res.status);
  }
  return res;
}
export async function qbo<T>(path: string, body?: unknown, requestId?: string): Promise<T> {
  const c = await connection();
  if (!c) throw new Error("Connect the MIP QuickBooks company first.");
  return (await rawRequest(c, await accessToken(c), path, body, requestId)).json();
}
export async function qboPdf(path: string) {
  const c = await connection();
  if (!c) throw new Error("QuickBooks is not connected.");
  return (await rawRequest(c, await accessToken(c), path, undefined, undefined, true)).arrayBuffer();
}
export function queryLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
