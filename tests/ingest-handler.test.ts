import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { withIngestAuth } from "@/lib/ingest/handler";

const ORIGINAL_TOKEN = process.env.INGEST_BEARER_TOKEN;

function makeJsonReq(
  method: string,
  headers: Record<string, string>,
  body?: unknown
): Request {
  return new Request("https://example.test/api/ingest/test", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("withIngestAuth", () => {
  beforeEach(() => {
    process.env.INGEST_BEARER_TOKEN = "secret-token";
  });
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.INGEST_BEARER_TOKEN;
    else process.env.INGEST_BEARER_TOKEN = ORIGINAL_TOKEN;
  });

  it("passes parsed JSON body to the handler on POST", async () => {
    interface Body {
      events: number[];
    }
    const handler = vi.fn(async ({ body }: { body: Body | undefined }) => {
      return Response.json({ echoed: body });
    });
    const wrapped = withIngestAuth<Body>(handler);

    const req = makeJsonReq(
      "POST",
      {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      { events: [1, 2, 3] }
    );
    const res = await wrapped(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ echoed: { events: [1, 2, 3] } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes undefined body when no content-type is set", async () => {
    const handler = vi.fn(async ({ body }: { body: unknown }) => {
      return Response.json({ bodyIsUndefined: body === undefined });
    });
    const wrapped = withIngestAuth(handler);
    const req = makeJsonReq("POST", {
      authorization: "Bearer secret-token",
    });
    const res = await wrapped(req);
    const json = await res.json();
    expect(json).toEqual({ bodyIsUndefined: true });
  });

  it("passes undefined body to GET handlers", async () => {
    const handler = vi.fn(async ({ body }: { body: unknown }) => {
      return Response.json({ bodyIsUndefined: body === undefined });
    });
    const wrapped = withIngestAuth(handler);
    const req = new Request("https://example.test/api/ingest/test", {
      method: "GET",
      headers: { authorization: "Bearer secret-token" },
    });
    const res = await wrapped(req);
    const json = await res.json();
    expect(json).toEqual({ bodyIsUndefined: true });
  });

  it("returns 401 without calling handler when auth fails", async () => {
    const handler = vi.fn(async () => Response.json({}));
    const wrapped = withIngestAuth(handler);
    const req = makeJsonReq("POST", {}); // no auth header
    const res = await wrapped(req);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON body", async () => {
    const handler = vi.fn(async () => Response.json({}));
    const wrapped = withIngestAuth(handler);
    const req = new Request("https://example.test/api/ingest/test", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
      },
      body: "{not-json",
    });
    const res = await wrapped(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Invalid JSON body" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 500 with the error message when the handler throws", async () => {
    const handler = vi.fn(async () => {
      throw new Error("boom");
    });
    const wrapped = withIngestAuth(handler);
    const req = makeJsonReq("POST", {
      authorization: "Bearer secret-token",
    });
    // Silence expected console.error from the wrapper.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await wrapped(req);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "boom" });
  });
});
