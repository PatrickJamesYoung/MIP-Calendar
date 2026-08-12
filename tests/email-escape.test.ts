import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/email/resend-client";

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml('<script>alert("xss & foo\'s")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss &amp; foo&#39;s&quot;)&lt;/script&gt;"
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Hello, world")).toBe("Hello, world");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("escapes ampersands before entities to avoid double-encoding", () => {
    // "&amp;" input should become "&amp;amp;", not "&amp;" again.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});
