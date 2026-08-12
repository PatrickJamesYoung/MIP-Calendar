import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkIngestAuth } from "@/lib/ingest/auth";

const ORIGINAL_TOKEN = process.env.INGEST_BEARER_TOKEN;

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/ingest/test", {
    method: "POST",
    headers,
  });
}

describe("checkIngestAuth", () => {
  beforeEach(() => {
    process.env.INGEST_BEARER_TOKEN = "shhh-secret-value";
  });
  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.INGEST_BEARER_TOKEN;
    else process.env.INGEST_BEARER_TOKEN = ORIGINAL_TOKEN;
  });

  it("accepts the exact bearer token", () => {
    const result = checkIngestAuth(
      makeReq({ authorization: "Bearer shhh-secret-value" })
    );
    expect(result.ok).toBe(true);
  });

  it("accepts case-insensitive scheme", () => {
    const result = checkIngestAuth(
      makeReq({ authorization: "bearer shhh-secret-value" })
    );
    expect(result.ok).toBe(true);
  });

  it("rejects when the authorization header is missing", async () => {
    const result = checkIngestAuth(makeReq());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body).toEqual({ error: "Missing bearer token" });
    }
  });

  it("rejects an incorrect token", async () => {
    const result = checkIngestAuth(
      makeReq({ authorization: "Bearer wrong-value" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body).toEqual({ error: "Invalid bearer token" });
    }
  });

  it("rejects a token with different length", async () => {
    const result = checkIngestAuth(
      makeReq({ authorization: "Bearer short" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  it("returns 500 when INGEST_BEARER_TOKEN is not configured", async () => {
    delete process.env.INGEST_BEARER_TOKEN;
    const result = checkIngestAuth(
      makeReq({ authorization: "Bearer whatever" })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      const body = await result.response.json();
      expect(body.error).toMatch(/not configured/i);
    }
  });
});
