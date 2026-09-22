import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { composeWithLlm } from "@/lib/daybook/compose";

const OK_JSON = {
  edition: "daybook",
  publication_date: "2026-09-22",
  subject: "Tuesday, September 22 · Daybook",
  intro: "Test intro.",
  movement_calendar: [],
  white_house: [],
  congress: [
    {
      chamber: "senate",
      committee: "Judiciary",
      title: "Oversight hearing",
      start: "2026-09-22T10:00:00-04:00",
    },
  ],
  scotus: [],
  dc_gov: [],
  alert_dc: [],
};

function agentApiResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "resp_test",
    status: "completed",
    output_text: JSON.stringify(OK_JSON),
    usage: { input_tokens: 500, output_tokens: 200 },
    ...overrides,
  };
}

describe("composeWithLlm — Perplexity Agent API", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PERPLEXITY_API_KEY;

  beforeEach(() => {
    process.env.PERPLEXITY_API_KEY = "test-key";
    process.env.DAYBOOK_PERPLEXITY_MODEL = "sonar-pro";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.PERPLEXITY_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("throws if PERPLEXITY_API_KEY is unset", async () => {
    delete process.env.PERPLEXITY_API_KEY;
    await expect(
      composeWithLlm({ publication_date: "2026-09-22", edition: "daybook", sources: {} }),
    ).rejects.toThrow(/PERPLEXITY_API_KEY/);
  });

  it("posts to the Agent API with json_schema response_format and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(agentApiResponse()), { status: 200 }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await composeWithLlm({
      publication_date: "2026-09-22",
      edition: "daybook",
      sources: { congress: { ok: true } },
    });

    expect(out.model).toBe("sonar-pro");
    expect(out.tokens_in).toBe(500);
    expect(out.tokens_out).toBe(200);
    expect(out.json.subject).toContain("Daybook");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe("https://api.perplexity.ai/v1/agent");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("sonar-pro");
    expect(body.tools).toEqual([]);
    const rf = body.response_format as { type: string; json_schema: { name: string } };
    expect(rf.type).toBe("json_schema");
    expect(rf.json_schema.name).toBe("daybook_composition");
    expect(String(body.input)).toContain("2026-09-22");
  });

  it("retries once with a larger token budget on empty output", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(agentApiResponse({ output_text: "" })), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(agentApiResponse()), { status: 200 }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await composeWithLlm({
      publication_date: "2026-09-22",
      edition: "daybook",
      sources: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const secondBody = JSON.parse(secondCall[1].body as string) as Record<string, unknown>;
    expect(secondBody.max_output_tokens).toBe(8192);
    expect(out.json.subject).toContain("Daybook");
  });

  it("does not retry on 4xx HTTP errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad key", { status: 401 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      composeWithLlm({ publication_date: "2026-09-22", edition: "daybook", sources: {} }),
    ).rejects.toThrow(/perplexity_agent_401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to output[].content[].text when output_text is absent", async () => {
    const rawResp = {
      id: "resp_test",
      status: "completed",
      // no output_text
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: JSON.stringify(OK_JSON) }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify(rawResp), { status: 200 }),
    ) as typeof fetch;

    const out = await composeWithLlm({
      publication_date: "2026-09-22",
      edition: "daybook",
      sources: {},
    });
    expect(out.json.subject).toContain("Daybook");
  });
});
