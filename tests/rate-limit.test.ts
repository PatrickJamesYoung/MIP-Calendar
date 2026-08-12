import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  clientIpFromHeaders,
  _resetBucketsForTests,
} from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetBucketsForTests();
  });

  it("allows requests under the limit", () => {
    const cfg = { name: "t", max: 3, windowMs: 60_000 } as const;
    expect(checkRateLimit("ip-a", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-a", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-a", cfg).ok).toBe(true);
  });

  it("blocks the (max+1)-th request in the window", () => {
    const cfg = { name: "t", max: 2, windowMs: 60_000 } as const;
    checkRateLimit("ip-b", cfg);
    checkRateLimit("ip-b", cfg);
    const third = checkRateLimit("ip-b", cfg);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.retryInSec).toBeGreaterThan(0);
      expect(third.retryInSec).toBeLessThanOrEqual(60);
    }
  });

  it("keys buckets separately per (name, id) pair", () => {
    const cfgA = { name: "bucket-a", max: 1, windowMs: 60_000 } as const;
    const cfgB = { name: "bucket-b", max: 1, windowMs: 60_000 } as const;
    // Same ip, different buckets — both first hits allowed.
    expect(checkRateLimit("ip-c", cfgA).ok).toBe(true);
    expect(checkRateLimit("ip-c", cfgB).ok).toBe(true);
    // Second hit in each bucket blocked.
    expect(checkRateLimit("ip-c", cfgA).ok).toBe(false);
    expect(checkRateLimit("ip-c", cfgB).ok).toBe(false);
  });

  it("does not share buckets across different IPs", () => {
    const cfg = { name: "t", max: 1, windowMs: 60_000 } as const;
    expect(checkRateLimit("ip-d1", cfg).ok).toBe(true);
    expect(checkRateLimit("ip-d2", cfg).ok).toBe(true);
    // Each IP's second hit should block.
    expect(checkRateLimit("ip-d1", cfg).ok).toBe(false);
    expect(checkRateLimit("ip-d2", cfg).ok).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers first x-forwarded-for entry", () => {
    const headers = new Headers({
      "x-forwarded-for": "5.6.7.8, 9.10.11.12",
      "x-real-ip": "13.14.15.16",
    });
    expect(clientIpFromHeaders(headers)).toBe("5.6.7.8");
  });

  it("trims whitespace around the extracted address", () => {
    const headers = new Headers({
      "x-forwarded-for": "  1.2.3.4  , 5.6.7.8",
    });
    expect(clientIpFromHeaders(headers)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const headers = new Headers({ "x-real-ip": "13.14.15.16" });
    expect(clientIpFromHeaders(headers)).toBe("13.14.15.16");
  });

  it("returns 'unknown' when no ip headers are set", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
