/**
 * LLM composition for the Daybook / Weekly Planner.
 *
 * Primary: Claude Sonnet 4.5 via @ai-sdk/anthropic.
 * Fallback: GPT-5 via @ai-sdk/openai. Fallback fires only on primary error
 * (network/timeout/refusal) — NOT on schema validation failure, because a
 * schema failure is a prompt bug and the fallback would repeat it.
 *
 * Output shape is guaranteed by generateObject() + Zod. If Anthropic
 * returns a value that doesn't fit `DaybookComposition`, the AI SDK
 * throws a NoObjectGeneratedError, which we surface as a compose failure
 * upstream (which marks the run failed — no send).
 *
 * The prompt is loaded from a file (`prompts/compose.md`) so prompt
 * changes go through PR review.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { DaybookComposition } from "./types";
import type { z } from "zod";

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
  ].join("\n");
}

/**
 * Compose using Anthropic primary, OpenAI fallback.
 *
 * Temperature is fixed at 0.2 — this is a compilation task, not creative
 * writing. Higher values hurt reliability with no quality gain on the
 * kinds of factual sections the Daybook contains.
 */
export async function composeWithLlm(input: ComposeInput): Promise<ComposeOutput> {
  const systemPrompt = await loadPrompt();
  const userMessage = buildUserMessage(input);

  // ---- Primary: Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const modelName = process.env.DAYBOOK_ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
      const result = await generateObject({
        model: anthropic(modelName),
        schema: DaybookComposition,
        system: systemPrompt,
        prompt: userMessage,
        temperature: 0.2,
      });
      return {
        json: result.object,
        model: modelName,
        tokens_in: result.usage?.inputTokens ?? 0,
        tokens_out: result.usage?.outputTokens ?? 0,
      };
    } catch (err) {
      // Fall through to OpenAI. If the error is a schema-shape failure the
      // fallback is likely to repeat it, but network/refusal errors are
      // exactly what the fallback exists for.
      if (!process.env.OPENAI_API_KEY) {
        throw err;
      }
      console.warn(`[compose] anthropic failed, falling back to openai: ${(err as Error).message}`);
    }
  }

  // ---- Fallback: OpenAI
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "compose: neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set — cannot compose",
    );
  }
  const modelName = process.env.DAYBOOK_OPENAI_MODEL ?? "gpt-5";
  const result = await generateObject({
    model: openai(modelName),
    schema: DaybookComposition,
    system: systemPrompt,
    prompt: userMessage,
    temperature: 0.2,
  });
  return {
    json: result.object,
    model: modelName,
    tokens_in: result.usage?.inputTokens ?? 0,
    tokens_out: result.usage?.outputTokens ?? 0,
  };
}
