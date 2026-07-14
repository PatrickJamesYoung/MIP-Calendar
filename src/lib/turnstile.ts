/**
 * Server-side verification of Cloudflare Turnstile tokens.
 *
 * Public site key: NEXT_PUBLIC_TURNSTILE_SITE_KEY (used by the widget)
 * Secret key:      TURNSTILE_SECRET_KEY
 *
 * If TURNSTILE_SECRET_KEY is unset, verification always passes with a
 * warning log — same rationale as email: don't block the submission flow
 * in dev/preview environments that don't have Turnstile wired up.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(
  token: string | null,
  remoteIp?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set — skipping verification");
    return { ok: true };
  }
  if (!token) {
    return { ok: false, error: "Missing captcha token" };
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
    });
    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    if (!data.success) {
      return {
        ok: false,
        error: `Captcha failed: ${(data["error-codes"] ?? []).join(", ") || "unknown"}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Captcha verify error: ${(e as Error).message}` };
  }
}
