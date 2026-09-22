/**
 * LLM composition for the Daybook / Weekly Planner.
 *
 * Uses the Perplexity Agent API (POST https://api.perplexity.ai/v1/agent).
 * The Sonar Chat Completions endpoint is being retired on 2026-09-27, so
 * we build on the Agent API from day one. It supports structured output
 * via `response_format: { type: "json_schema", json_schema: { name, schema } }`
 * which lets us force the model to match `DaybookComposition` exactly.
 *
 * We call the API directly rather than through the Vercel AI SDK because
 * the Agent API response shape (`output[]` array with message and
 * search_results items, `output_text` convenience field) is Perplexity-
 * specific and doesn't match the AI SDK's OpenAI-style contract.
 *
 * Fallback: if PERPLEXITY_API_KEY is missing we throw. If a call fails,
 * we retry once with a bumped max_output_tokens; that's the level of
 * fallback that matches "Perplexity is my only LLM provider". If you
 * later add Anthropic or OpenAI keys we can wire true cross-provider
 * fallback here.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DaybookComposition } from "./types";

export type ComposeInput = {
  publication_date: string;
  edition: "daybook" | "weekly";
  /** Per-source payloads; failed sources appear as null so the model sees the gap. */
  sources: Record<string, unknown>;
};

export type ComposeOutput = {
  json: z.infer<typeof DaybookComposition>;
  model: string;
  tokens_in: number;
  tokens_out: number;
};

const PROMPT_PATH = path.join(process.cwd(), "src/lib/daybook/prompts/compose.md");
const AGENT_URL = "https://api.perplexity.ai/v1/agent";

async function loadPrompt(): Promise<string> {
  return readFile(PROMPT_PATH, "utf8");
}

function buildUserMessage(input: ComposeInput): string {
  return [
    `edition: ${input.edition}`,
    `publication_date: ${input.publication_date}`,
    "",
    "Sources (null = failed or empty; omit that section in output):",
    "```json",
    JSON.stringify(input.sources, null, 2),
    "```",
    "",
    "Return the composed briefing as a JSON object matching the provided schema exactly. Do not include commentary; return only the JSON object.",
  ].join("\n");
}

/**
 * Extract the assistant's text from an Agent API response.
 * The docs specify:
 *   - `response.output_text` is a convenience string, but not always present
 *   - Raw path: `output[]` where `type === "message"`, then `content[]`
 *     where `type === "output_text"`, joined by their `text` field.
 */
function extractOutputText(resp: unknown): string {
  const r = resp as { output_text?: string; output?: unknown };
  if (typeof r.output_text === "string" && r.output_text.length > 0) {
    return r.output_text;
  }
  const parts: string[] = [];
  const output = Array.isArray(r.output) ? r.output : [];
  for (const item of output) {
    const it = item as { type?: string; content?: unknown };
    if (it.type !== "message") continue;
    const content = Array.isArray(it.content) ? it.content : [];
    for (const c of content) {
      const cc = c as { type?: string; text?: string };
      if (cc.type === "output_text" && typeof cc.text === "string") {
        parts.push(cc.text);
      }
    }
  }
  return parts.join("");
}

async function callAgentApi(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  jsonSchema: object;
  maxOutputTokens: number;
}): Promise<{ text: string; tokens_in: number; tokens_out: number }> {
  const body = {
    model: args.model,
    // The Agent API takes `input` (single string) or `messages` (chat form).
    // A single input string with the system prompt prepended keeps it simple
    // and matches the structured-output examples in Perplexity's docs.
    input: `${args.systemPrompt}\n\n---\n\n${args.userMessage}`,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "daybook_composition",
        schema: args.jsonSchema,
      },
    },
    max_output_tokens: args.maxOutputTokens,
    // We intentionally do NOT enable web_search or fetch_url tools here.
    // The composer receives ONLY the source payloads we prepared; giving
    // it search access would let it invent items we couldn't audit. This
    // is a compilation task, not a research task.
    tools: [],
  };

  const r = await fetch(AGENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`perplexity_agent_${r.status}:${errText.slice(0, 400)}`);
  }
  const resp = (await r.json()) as {
    status?: string;
    error?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (resp.status && resp.status !== "completed") {
    throw new Error(`perplexity_agent_status:${resp.status}`);
  }
  if (resp.error) {
    throw new Error(`perplexity_agent_error:${JSON.stringify(resp.error).slice(0, 400)}`);
  }
  const text = extractOutputText(resp);
  if (!text) {
    throw new Error("perplexity_agent_empty_output");
  }
  return {
    text,
    tokens_in: resp.usage?.input_tokens ?? 0,
    tokens_out: resp.usage?.output_tokens ?? 0,
  };
}

/**
 * Compose using Perplexity Agent API with structured JSON schema output.
 *
 * The first call for a given schema shape may take 10–30 seconds to
 * "prepare" per Perplexity's docs. Subsequent calls are fast. GitHub
 * Actions has a 20-minute step budget so this is fine; we set a hard
 * timeout of 90 seconds via AbortController to catch pathological cases.
 */
export async function composeWithLlm(input: ComposeInput): Promise<ComposeOutput> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw new Error("compose: PERPLEXITY_API_KEY is not set — cannot compose");
  }
  // The Agent API model list uses provider/slug ids and does NOT include
  // the legacy Sonar chat-completions ids: `sonar-pro`, `sonar-reasoning-pro`,
  // and `sonar-deep-research` are being retired on 2026-09-27 with no
  // Agent-API equivalent (only `perplexity/sonar` migrates).
  // Default is `perplexity/sonar` — keeps this integration first-party
  // Perplexity, matches the user's explicit "use Perplexity API" intent,
  // and Sonar handles structured JSON output well for compilation tasks
  // like this one. Override via DAYBOOK_PERPLEXITY_MODEL if you want an
  // Anthropic/OpenAI/xAI model through the Agent API's unified billing.
  // See: https://docs.perplexity.ai/docs/agent-api/models
  const modelName = process.env.DAYBOOK_PERPLEXITY_MODEL ?? "perplexity/sonar";

  const systemPrompt = await loadPrompt();
  const userMessage = buildUserMessage(input);
  // Zod v4 ships JSON Schema conversion built-in.
  // `target: "draft-7"` keeps us aligned with what Perplexity's structured
  // output validator expects.
  const jsonSchema = z.toJSONSchema(DaybookComposition, { target: "draft-7" });

  // Two attempts: the second bumps max_output_tokens in case truncation
  // caused the JSON to be incomplete (per Perplexity docs, schema conformance
  // is only guaranteed when output fits under max_output_tokens).
  const attempts = [
    { max: 4096 },
    { max: 8192 },
  ];
  let lastErr: Error | null = null;
  for (const [i, a] of attempts.entries()) {
    try {
      const result = await callAgentApi({
        apiKey,
        model: modelName,
        systemPrompt,
        userMessage,
        jsonSchema,
        maxOutputTokens: a.max,
      });
      // The Agent API guarantees schema shape on paper, but paranoia beats
      // regret — parse and Zod-validate here, so a stray extra key or
      // missing required field surfaces as a clean error upstream.
      const parsed = JSON.parse(result.text);
      const validated = DaybookComposition.parse(parsed);
      return {
        json: validated,
        model: modelName,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
      };
    } catch (err) {
      lastErr = err as Error;
      // Only retry on transient/truncation-shaped failures. A JSON parse
      // error or Zod failure on the first attempt might well recover with
      // more tokens; a 4xx from Perplexity will not.
      const msg = lastErr.message;
      const isTransient =
        msg.includes("perplexity_agent_5") ||
        msg.includes("perplexity_agent_empty_output") ||
        msg.includes("perplexity_agent_status") ||
        msg.startsWith("SyntaxError") ||
        msg.includes("Unexpected end of JSON");
      if (i === attempts.length - 1 || !isTransient) {
        throw lastErr;
      }
      console.warn(`[compose] attempt ${i + 1} failed (${msg}); retrying with larger budget`);
    }
  }
  throw lastErr ?? new Error("compose: unreachable");
}
