import { z } from "zod";
import { isValidSlug, SLUG_MAX_LEN } from "./slug";

/**
 * Zod schemas for wiki server actions. Shared between create and update
 * flows so validation is identical everywhere.
 */

export const wikiPageInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title must be 200 characters or fewer"),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(SLUG_MAX_LEN, `Slug must be ${SLUG_MAX_LEN} characters or fewer`)
    .refine(isValidSlug, {
      message: "Slug must be lowercase letters, numbers, and hyphens",
    }),
  summary: z
    .string()
    .trim()
    .max(500, "Summary must be 500 characters or fewer")
    .optional()
    .transform((s) => (s ? s : null)),
  body_md: z.string().max(500_000, "Page body is too large").default(""),
});

export type WikiPageInput = z.infer<typeof wikiPageInputSchema>;
