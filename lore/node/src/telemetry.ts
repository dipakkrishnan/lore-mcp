/** Span attribute vocabulary for the node's paid path (XC-030/MON-020).
 *
 * This generalizes the `JOB_SUMMARIES` precedent in `lore/store.py`: every
 * value that can reach a span is a coded value from a closed vocabulary,
 * never prose, and never anything derived from user content, an exception,
 * a path, or a URL. Content, wallet addresses, transaction hashes, and buyer
 * questions never pass through this module — see docs/telemetry.md for the
 * full privacy rules. `assertAllowedAttributes` and `assertKnownOutcome`
 * make that a runtime guarantee, not just a convention: an attribute or
 * outcome outside the allowlist throws rather than being forwarded, the
 * same defense-in-depth `OwnerJob`'s validator gives the local job history.
 *
 * Traces stay inside the owner's own Cloudflare account — see the
 * `observability` block in wrangler.jsonc — so this module never sends
 * anything anywhere itself; it only shapes what a span may carry.
 */
import { createHash } from "node:crypto";

/** The closed outcome vocabulary, shared across every span kind. Not every
 * value applies to every span (mirrors JOB_SUMMARIES, whose dict is shared
 * across job kinds the same way). `unpaid` documents the 402-challenge state,
 * which is handled entirely inside the x402 middleware before any of these
 * functions run — it is visible only through the platform's own request
 * tracing, never emitted here. */
export const OUTCOMES = [
  "ok",
  "not_found",
  "invalid_id",
  "unpaid",
  "disabled",
  "settle_failed",
  "model_error",
  "deadline"
] as const;
export type Outcome = (typeof OUTCOMES)[number];

const OUTCOME_SET: ReadonlySet<string> = new Set(OUTCOMES);

export function isKnownOutcome(value: string): value is Outcome {
  return OUTCOME_SET.has(value);
}

export function assertKnownOutcome(value: string): asserts value is Outcome {
  if (!isKnownOutcome(value)) {
    throw new Error(`lore/telemetry: outcome not in the closed vocabulary: ${value}`);
  }
}

/** The complete set of attribute keys any span may carry. Adding a key here
 * is a privacy decision, not a refactor — it must stay content-free. */
export const SPAN_ATTRIBUTES = [
  "lore.tool",
  "lore.outcome",
  "lore.paid",
  "lore.item_hash",
  "lore.settled",
  "lore.answer.model",
  "lore.answer.input_tokens",
  "lore.answer.output_tokens",
  "lore.answer.cost_usd",
  "lore.answer.tool_calls",
  "lore.answer.duration_ms"
] as const;
export type SpanAttributeKey = (typeof SPAN_ATTRIBUTES)[number];
export type SpanAttributes = Partial<Record<SpanAttributeKey, string | number | boolean>>;

const ATTRIBUTE_SET: ReadonlySet<string> = new Set(SPAN_ATTRIBUTES);

export function isKnownAttribute(key: string): key is SpanAttributeKey {
  return ATTRIBUTE_SET.has(key);
}

function assertAllowedAttributes<T extends SpanAttributes>(attrs: T): T {
  for (const key of Object.keys(attrs)) {
    if (!isKnownAttribute(key)) {
      throw new Error(`lore/telemetry: attribute not in the allowlist: ${key}`);
    }
  }
  return attrs;
}

/** Hashes an identifier (a publication or ticket id) so a span can correlate
 * repeated activity on the same item without disclosing which item it is.
 * Same construction as `validPublicId`'s checksum in answer-state.ts. */
export function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Attributes for one MCP tool call (`discover`, `get`, `answer`, `result`).
 * `itemId`, when given, is hashed — the raw publication or ticket id never
 * becomes a span attribute. */
export function toolSpanAttributes(options: {
  tool: string;
  outcome: Outcome;
  paid?: boolean;
  itemId?: string;
}): SpanAttributes {
  assertKnownOutcome(options.outcome);
  const attrs: SpanAttributes = {
    "lore.tool": options.tool,
    "lore.outcome": options.outcome
  };
  if (options.paid !== undefined) attrs["lore.paid"] = options.paid;
  if (options.itemId !== undefined) attrs["lore.item_hash"] = hashId(options.itemId);
  return assertAllowedAttributes(attrs);
}

/** Attributes for a settlement (sales.ts's `recorded()` wrapper). Carries
 * only whether the ledger write succeeded — never the payer address or
 * transaction hash the settlement receipt actually contains. */
export function settlementSpanAttributes(options: { settled: boolean; outcome: Outcome }): SpanAttributes {
  assertKnownOutcome(options.outcome);
  return assertAllowedAttributes({
    "lore.settled": options.settled,
    "lore.outcome": options.outcome
  });
}

/** Promotes the already-computed `AnswerTelemetry` onto a span. These
 * numbers are already persisted to D1 (`answer_jobs`), so this is a second
 * read of existing data, not new collection — and it never touches the
 * buyer's question, which is a separate field this function never accepts. */
export function answerSpanAttributes(telemetry: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  durationMs: number;
}): SpanAttributes {
  return assertAllowedAttributes({
    "lore.answer.model": telemetry.model,
    "lore.answer.input_tokens": telemetry.inputTokens,
    "lore.answer.output_tokens": telemetry.outputTokens,
    "lore.answer.cost_usd": telemetry.costUsd,
    "lore.answer.tool_calls": telemetry.toolCalls,
    "lore.answer.duration_ms": telemetry.durationMs
  });
}
