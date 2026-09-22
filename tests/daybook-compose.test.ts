import { describe, it, expect, vi, beforeEach } from "vitest";
import { DaybookComposition } from "@/lib/daybook/types";

// Mock the AI SDK before importing the module under test.
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (name: string) => ({ __anthropic: name }),
}));
vi.mock("@ai-sdk/openai", () => ({
  openai: (name: string) => ({ __openai: name }),
}));

import { generateObject } from "ai";
import { composeWithLlm } from "@/lib/daybook/compose";

const validObject = DaybookComposition.parse({
  edition: "daybook",
  publication_date: "2026-09-22",
  subject: "DC Daybook — September 22, 2026",
  movement_calendar: [],
  white_house: [],
  congress: [],
  scotus: [],
  dc_gov: [],
  alert_dc: [],
});

describe("composeWithLlm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("throws when no provider key is configured", async () => {
    await expect(
      composeWithLlm({ publication_date: "2026-09-22", edition: "daybook", sources: {} }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY.*OPENAI_API_KEY/);
  });

  it("uses Anthropic when key is set and returns validated object", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(generateObject).mockResolvedValueOnce({
      // @ts-expect-error partial mock
      object: validObject,
      usage: { inputTokens: 100, outputTokens: 200 },
    });
    const out = await composeWithLlm({
      publication_date: "2026-09-22",
      edition: "daybook",
      sources: {},
    });
    expect(out.json.subject).toContain("September 22, 2026");
    expect(out.tokens_in).toBe(100);
    expect(out.tokens_out).toBe(200);
    expect(out.model).toContain("claude-sonnet");
  });

  it("falls back to OpenAI when Anthropic throws and OpenAI key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.OPENAI_API_KEY = "sk-openai";
    vi.mocked(generateObject)
      .mockRejectedValueOnce(new Error("network_timeout"))
      .mockResolvedValueOnce({
        // @ts-expect-error partial mock
        object: validObject,
        usage: { inputTokens: 50, outputTokens: 75 },
      });
    const out = await composeWithLlm({
      publication_date: "2026-09-22",
      edition: "daybook",
      sources: {},
    });
    expect(out.model).toContain("gpt");
    expect(out.tokens_out).toBe(75);
  });

  it("rethrows the primary error when no fallback is configured", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    vi.mocked(generateObject).mockRejectedValueOnce(new Error("boom"));
    await expect(
      composeWithLlm({ publication_date: "2026-09-22", edition: "daybook", sources: {} }),
    ).rejects.toThrow(/boom/);
  });
});
