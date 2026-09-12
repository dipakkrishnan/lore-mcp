import { createHash } from "node:crypto";
import { z } from "zod";
import type { AnswerTelemetry } from "./answer-state.js";

// The single privacy schema for Lore's custom attributes, not platform logs.
const metric = z.number().finite().nonnegative();
const attributes = z.strictObject({
  "lore.tool": z.enum(["discover", "get", "answer", "result"]),
  "lore.outcome": z.enum(["ok", "not_found", "disabled", "ledger_failed"]),
  "lore.paid": z.boolean(),
  "lore.item_hash": z.string().regex(/^[0-9a-f]{16}$/),
  "lore.settled": z.boolean(),
  "lore.answer.model": z.enum(["claude-sonnet-5", "gpt-5.6-luna"]),
  "lore.answer.input_tokens": metric,
  "lore.answer.output_tokens": metric,
  "lore.answer.cost_usd": metric,
  "lore.answer.tool_calls": metric,
  "lore.answer.duration_ms": metric
}).partial();

export type SpanAttributes = z.infer<typeof attributes>;
type Outcome = NonNullable<SpanAttributes["lore.outcome"]>;
type ToolOptions = {
  tool: NonNullable<SpanAttributes["lore.tool"]>;
  outcome: Exclude<Outcome, "ledger_failed">;
  paid?: boolean;
  itemId?: string;
};
type SettlementOptions = { settled: boolean; outcome: Extract<Outcome, "ok" | "ledger_failed"> };

function validate(value: unknown): SpanAttributes {
  const result = attributes.safeParse(value);
  if (!result.success) throw new Error("lore/telemetry: invalid attributes");
  return result.data;
}

export function toolSpanAttributes({ tool, outcome, paid, itemId }: ToolOptions): SpanAttributes {
  return validate({
    "lore.tool": tool,
    "lore.outcome": outcome,
    ...(paid === undefined ? {} : { "lore.paid": paid }),
    ...(itemId === undefined ? {} : {
      "lore.item_hash": createHash("sha256").update(itemId).digest("hex").slice(0, 16)
    })
  });
}

export function settlementSpanAttributes({ settled, outcome }: SettlementOptions): SpanAttributes {
  return validate({ "lore.settled": settled, "lore.outcome": outcome });
}

/** Reuses the usage already persisted with the answer; never accepts its text. */
export function answerSpanAttributes(telemetry: AnswerTelemetry): SpanAttributes {
  return validate({
    "lore.answer.model": telemetry.model,
    "lore.answer.input_tokens": telemetry.inputTokens,
    "lore.answer.output_tokens": telemetry.outputTokens,
    "lore.answer.cost_usd": telemetry.costUsd,
    "lore.answer.tool_calls": telemetry.toolCalls,
    "lore.answer.duration_ms": telemetry.durationMs
  });
}
