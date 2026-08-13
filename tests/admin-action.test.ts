import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks are hoisted by vitest, so mocked modules must be declared before
// the imports that pull them in transitively.
const requireAdminMock = vi.fn();
const createAdminClientMock = vi.fn();
const createServerClientMock = vi.fn();
const revalidatePathMock = vi.fn();
const isRedirectErrorMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/dist/client/components/redirect-error", () => ({
  isRedirectError: (e: unknown) => isRedirectErrorMock(e),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClientMock(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createServerClientMock(),
}));

import {
  adminAction,
  adminFormAction,
  AdminActionError,
} from "@/lib/admin/action";

const FAKE_ADMIN = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.c" };

function makeAuditCapturingServerClient() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from }, insert, from };
}

describe("adminAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRedirectErrorMock.mockReturnValue(false);
    requireAdminMock.mockResolvedValue(FAKE_ADMIN);
    createAdminClientMock.mockReturnValue({}); // handler-specific in each test
  });

  it("returns { ok: true, data } on success and calls revalidatePath", async () => {
    const wrapped = adminAction<{ n: number }, number>(
      async (_ctx, { n }) => n * 2,
      { revalidate: "/admin/things" },
    );

    const result = await wrapped({ n: 21 });
    expect(result).toEqual({ ok: true, data: 42 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/things");
  });

  it("passes admin + supabase context to the handler", async () => {
    const fakeSupabase = { tag: "admin-client" };
    createAdminClientMock.mockReturnValue(fakeSupabase);

    let observed: unknown = null;
    const wrapped = adminAction<undefined, string>(async (ctx) => {
      observed = ctx;
      return "ok";
    });
    await wrapped(undefined);

    expect(observed).toEqual({ admin: FAKE_ADMIN, supabase: fakeSupabase });
  });

  it("converts AdminActionError to a typed failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = adminAction(async () => {
      throw new AdminActionError("conflict", "Slug already exists");
    });
    const result = await wrapped(undefined);
    spy.mockRestore();
    expect(result).toEqual({
      ok: false,
      code: "conflict",
      message: "Slug already exists",
    });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("hides raw error messages from generic throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = adminAction(async () => {
      throw new Error("duplicate key violates unique constraint \"gear_items_slug_idx\"");
    });
    const result = await wrapped(undefined);
    spy.mockRestore();
    expect(result).toEqual({
      ok: false,
      code: "internal",
      message: "Something went wrong.",
    });
  });

  it("respects a custom errorMessage for the generic fallback", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = adminAction(
      async () => {
        throw new Error("db kaboom");
      },
      { errorMessage: "Could not save event." },
    );
    const result = await wrapped(undefined);
    spy.mockRestore();
    expect(result).toEqual({
      ok: false,
      code: "internal",
      message: "Could not save event.",
    });
  });

  it("re-throws Next redirect errors instead of swallowing them", async () => {
    isRedirectErrorMock.mockImplementation((e: unknown) => e instanceof Error && e.message === "NEXT_REDIRECT");
    const wrapped = adminAction(async () => {
      throw new Error("NEXT_REDIRECT");
    });
    await expect(wrapped(undefined)).rejects.toThrow("NEXT_REDIRECT");
  });

  it("writes an audit row on success when opts.audit is provided", async () => {
    const captured = makeAuditCapturingServerClient();
    createServerClientMock.mockResolvedValue(captured.client);

    const wrapped = adminAction<{ id: string }, { id: string }>(
      async (_ctx, { id }) => ({ id }),
      {
        audit: (result) => ({
          action: "gear_item.update",
          entityType: "gear_item",
          entityId: result.id,
          diff: { touched: true },
        }),
      },
    );

    const result = await wrapped({ id: "22222222-2222-2222-2222-222222222222" });
    expect(result.ok).toBe(true);

    expect(captured.from).toHaveBeenCalledWith("audit_log");
    expect(captured.insert).toHaveBeenCalledWith({
      admin_id: FAKE_ADMIN.id,
      action: "gear_item.update",
      entity_type: "gear_item",
      entity_id: "22222222-2222-2222-2222-222222222222",
      diff: { touched: true },
    });
  });

  it("does not write an audit row when the handler fails", async () => {
    const captured = makeAuditCapturingServerClient();
    createServerClientMock.mockResolvedValue(captured.client);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = adminAction(
      async () => {
        throw new AdminActionError("validation", "nope");
      },
      {
        audit: { action: "x", entityType: "y" },
      },
    );

    const result = await wrapped(undefined);
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(captured.insert).not.toHaveBeenCalled();
  });

  it("resolves revalidate paths from a function of (result, args)", async () => {
    const wrapped = adminAction<{ slug: string }, { slug: string }>(
      async (_ctx, args) => args,
      {
        revalidate: (result) => [`/admin/gear/${result.slug}`, "/admin/gear"],
      },
    );
    await wrapped({ slug: "mic-stand" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/gear/mic-stand");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/gear");
  });

  it("does not swallow audit-log failures — logs and still returns success", async () => {
    const insert = vi.fn().mockRejectedValue(new Error("audit table gone"));
    const from = vi.fn().mockReturnValue({ insert });
    createServerClientMock.mockResolvedValue({ from });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = adminAction<undefined, string>(async () => "ok", {
      audit: { action: "x", entityType: "y" },
    });
    const result = await wrapped(undefined);
    spy.mockRestore();

    // Audit failures must never bubble up to the caller.
    expect(result).toEqual({ ok: true, data: "ok" });
  });
});

describe("adminFormAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRedirectErrorMock.mockReturnValue(false);
    requireAdminMock.mockResolvedValue(FAKE_ADMIN);
    createAdminClientMock.mockReturnValue({});
  });

  it("propagates handler throws so Next's error boundary can render them", async () => {
    const wrapped = adminFormAction(async () => {
      throw new Error("Name is required");
    });
    await expect(wrapped(new FormData())).rejects.toThrow("Name is required");
  });

  it("runs the handler, revalidates, and audits on success", async () => {
    const captured = makeAuditCapturingServerClient();
    createServerClientMock.mockResolvedValue(captured.client);

    const handler = vi.fn(async () => undefined);
    const wrapped = adminFormAction(handler, {
      revalidate: "/admin/gear/catalog",
      audit: (formData) => ({
        action: "gear_item.create",
        entityType: "gear_item",
        diff: { slug: formData.get("slug") },
      }),
    });

    const form = new FormData();
    form.set("slug", "new-mic");
    await wrapped(form);

    expect(handler).toHaveBeenCalledOnce();
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/gear/catalog");
    expect(captured.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_id: FAKE_ADMIN.id,
        action: "gear_item.create",
        entity_type: "gear_item",
        entity_id: null,
        diff: { slug: "new-mic" },
      }),
    );
  });

  it("still throws when requireAdmin rejects (login redirect flow)", async () => {
    requireAdminMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const handler = vi.fn();
    const wrapped = adminFormAction(handler);
    await expect(wrapped(new FormData())).rejects.toThrow("NEXT_REDIRECT");
    expect(handler).not.toHaveBeenCalled();
  });
});
