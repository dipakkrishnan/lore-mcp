/** What the owner's agents may send `/agent`'s tools (XC-067), a leaf module (XC-100): the `store` item schema and
 * the length rule its fields share, tested in plain node instead of only through MCP. `agent.ts` registers the tools. */
import { z } from "zod";

/** A string `min`–`max` characters long, counted in code points as a person counts them, so an emoji is one. */
export function chars(field: string, min: number, max: number, base = z.string()) {
  const message = min ? `${field} must be ${min}–${max.toLocaleString("en-US")} characters` : `${field} must be at most ${max} characters`;
  return base.refine((value) => [...value].length >= min && [...value].length <= max, message);
}

export const key = chars("key", 1, 120, z.string().trim());

export const Save = z.object({
  title: chars("title", 1, 200).describe("A short, specific title, up to 200 characters."),
  content: chars("content", 1, 20_000).describe(
    "The memory itself, in the owner's own terms: what happened, what they learned or prefer, and why. Up to 20,000 characters."
  ),
  topic: chars("topic", 0, 80).nullish().describe("A few words naming the subject, up to 80 characters."),
  kind: z.enum(["experience", "lesson", "preference", "fact", "reference"]).nullish().describe("What sort of memory this is."),
  key: key
    .nullish()
    .describe("Your own stable name for this memory, up to 120 characters. Saving again under the same key replaces the earlier version, so use it to keep context current."),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, "occurred_at must be an ISO 8601 date")
    .nullish()
    .describe("When it happened, as an ISO 8601 date, if known.")
});
