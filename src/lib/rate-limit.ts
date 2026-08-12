/**
 * Simple in-process token-bucket rate limiter.
 *
 * Buckets are keyed by a string (usually an IP + a bucket name) and reset
 * on server restart, which is fine for our scale. The map is pruned lazily
 * on every check so we don't leak memory on long-running instances.
 *
 * If we ever need distributed rate limiting (e.g. Vercel scaled beyond one
 * region or serverless cold-starts wiping buckets), swap this for a Redis
 * or Supabase-backed store behind the same `check()` API.
 */

export interface RateLimitConfig {
  /** Human-readable label for the bucket, e.g. "submit" or "view". */
  name: string;
  /** Max hits allowed within `windowMs` before requests are rejected. */
  max: number;
  /** Rolling window duration in milliseconds. */
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// One shared map per process. Keys are `${config.name}:${identifier}`.
const buckets = new Map<string, Bucket>();

// Prune stale entries every ~1000 checks so the map doesn't grow forever
// under high traffic. Cheap and bounded.
let checksSincePrune = 0;
const PRUNE_EVERY = 1000;

function prune(now: number): void {
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): { ok: true } | { ok: false; retryInSec: number } {
  const now = Date.now();

  if (++checksSincePrune >= PRUNE_EVERY) {
    checksSincePrune = 0;
    prune(now);
  }

  const key = `${config.name}:${identifier}`;
  const entry = buckets.get(key);

  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    return { ok: true };
  }

  if (entry.count >= config.max) {
    return { ok: false, retryInSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true };
}

/**
 * Extract the caller's IP from Next.js request headers.
 * Falls back to "unknown" so we still get some coarse rate limiting even
 * if the header layer is misconfigured.
 */
export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Test helper: clear all buckets between test cases.
 *
 * Not exported through any public entry point — imported only by the
 * Vitest suite. In production this module is only loaded inside route
 * handlers, so there's no way for it to be called at runtime.
 */
export function _resetBucketsForTests(): void {
  buckets.clear();
  checksSincePrune = 0;
}
