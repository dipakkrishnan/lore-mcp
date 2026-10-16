import { z } from "zod";

/** contracts/inbox.md, "Limits". Lengths count code points, as the Python side does. */
export const LIMITS = {
  items: 20,
  keys: 50,
  waiting: 2_000,
  list: 200,
  received: 200,
  retention: 30 * 86_400_000
};

export const WINDOWS = [
  { span: "hour", size: 3_600_000, limit: 100, label: "100 writes an hour" },
  { span: "day", size: 86_400_000, limit: 1_000, label: "1,000 writes a day" }
] as const;

export const KINDS = ["experience", "lesson", "preference", "fact", "reference"] as const;
export const APPS = ["grok", "muse", "chatgpt", "claude", "other"] as const;

function chars(field: string, min: number, max: number, base = z.string()) {
  return base.refine((value) => {
    const length = [...value].length;
    return length >= min && length <= max;
  }, min ? `${field} must be ${min}–${max.toLocaleString("en-US")} characters` : `${field} must be at most ${max} characters`);
}

export const key = chars("key", 1, 120, z.string().trim());

export const Save = z.object({
  title: chars("title", 1, 200).describe("A short, specific title, up to 200 characters."),
  content: chars("content", 1, 20_000).describe(
    "The memory itself, in the owner's own terms: what happened, what they learned or prefer, and why. Up to 20,000 characters."
  ),
  topic: chars("topic", 0, 80).nullish().describe("A few words naming the subject, up to 80 characters."),
  kind: z.enum(KINDS).nullish().describe("What sort of memory this is."),
  key: key
    .nullish()
    .describe(
      "Your own stable name for this memory, up to 120 characters. Saving again under the same key replaces the earlier version, so use it to keep context current."
    ),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, "occurred_at must be an ISO 8601 date")
    .nullish()
    .describe("When it happened, as an ISO 8601 date, if known.")
});
export type Save = z.infer<typeof Save>;

export const NewOwner = z.object({ public_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "public_key must be 32 bytes, base64url") });
export const NewAgent = z.object({ name: chars("name", 1, 40), app: z.enum(APPS) });
export const Received = z.object({ ids: z.array(z.string()).max(LIMITS.received, `ids takes at most ${LIMITS.received}`) });
