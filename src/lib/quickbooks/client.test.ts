import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  row: {} as Record<string, unknown>, failUpdate: false, busy: false, order: [] as string[],
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: !mocks.busy, error: null }),
    from: (table: string) => {
      let patch: Record<string, unknown> | undefined;
      const chain = {
        select: () => chain, eq: () => chain, delete: () => chain,
        update: (v: Record<string, unknown>) => { patch = v; return chain; },
        maybeSingle: async () => ({ data: structuredClone(mocks.row), error: null }),
        then: (resolve: (r: unknown) => unknown) => {
          if (table === "qbo_connection" && patch) {
            if (mocks.failUpdate) return Promise.resolve(resolve({ error: { message: "unavailable" } }));
            mocks.order.push(patch.tokens_encrypted === "" ? "clear" : "disable");
            Object.assign(mocks.row, patch);
          }
          return Promise.resolve(resolve({ error: null }));
        },
      };
      return chain;
    },
  }),
}));
import { disconnectCompany, encryptTokens, qbo } from "./client";

beforeEach(() => {
  vi.stubEnv("QBO_CLIENT_ID", "test-client");
  vi.stubEnv("QBO_CLIENT_SECRET", "test-secret");
  vi.stubEnv("QBO_REDIRECT_URI", "https://portal.example/api/quickbooks/callback");
  vi.stubEnv("QBO_ENVIRONMENT", "sandbox");
  vi.stubEnv("QBO_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  mocks.failUpdate = false; mocks.busy = false; mocks.order = [];
  mocks.row = {
    realm_id: "123", environment: "sandbox", company_name: "Test Company",
    tokens_encrypted: encryptTokens({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 }),
    access_expires_at: new Date(Date.now() + 3600000).toISOString(),
    enabled: true, auto_send_disabled_confirmed: true,
  };
  vi.stubGlobal("fetch", vi.fn(async () => {
    mocks.order.push("revoke");
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("QuickBooks disconnect and request boundary", () => {
  it("disables, revokes, then removes local credentials without losing company identity", async () => {
    await disconnectCompany("123");
    expect(mocks.order).toEqual(["disable", "revoke", "clear"]);
    expect(mocks.row).toMatchObject({ enabled: false, auto_send_disabled_confirmed: false,
      tokens_encrypted: "", realm_id: "123" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
    expect(JSON.parse(String(init?.body))).toEqual({ token: "test-refresh" });
  });
  it("retains retryable credentials but disables invoicing on an ambiguous timeout", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));
    await expect(disconnectCompany("123")).rejects.toThrow("could not be confirmed");
    expect(mocks.row.enabled).toBe(false);
    expect(mocks.row.tokens_encrypted).not.toBe("");
  });
  it("does not claim success on provider rejection", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(disconnectCompany("123")).rejects.toThrow("not confirmed");
    expect(mocks.row.tokens_encrypted).not.toBe("");
  });
  it("blocks wrong-company and concurrent requests before any change", async () => {
    await expect(disconnectCompany("999")).rejects.toThrow("Company changed");
    mocks.busy = true;
    await expect(disconnectCompany("123")).rejects.toThrow("Another invoice");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not revoke if local disabling fails", async () => {
    mocks.failUpdate = true;
    await expect(disconnectCompany("123")).rejects.toThrow("Could not disable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes repeat disconnect idempotent", async () => {
    await disconnectCompany("123");
    await disconnectCompany("123");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses reads and writes after disconnect", async () => {
    await disconnectCompany("123");
    vi.mocked(fetch).mockClear();
    await expect(qbo("query")).rejects.toThrow("disconnected");
    await expect(qbo("invoice", {})).rejects.toThrow("disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
});
