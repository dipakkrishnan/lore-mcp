// The schema in src/telemetry.ts is the whole privacy contract for
// XC-030/MON-020; these tests prove nothing outside it reaches a span and
// that a tracing failure never costs a buyer their result. See docs/telemetry.md.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  answerSpanAttributes,
  settlementSpanAttributes,
  toolSpanAttributes
} from "../src/telemetry";

import { withSpan } from "../src/tracing";
import { captureSpans } from "./tracing";

afterEach(() => vi.restoreAllMocks());

// One example of each category of thing that must never reach a span:
// buyer content, a publication's private text, money/identity linkage, and a
// secret. None of these should ever be passed to these functions in real
// call sites — the point of this table is to prove the functions are safe
// even if a future call site gets that wrong.
const SECRETS: Record<string, string> = {
  buyerQuestion: "What is my ex's phone number and address?",
  walletAddress: "0xABCDEF1234567890abcdef1234567890ABCDEF12",
  transactionHash: `0x${"a".repeat(64)}`,
  publicationTitle: "My Secret Diary Entry About the Layoffs",
  publicationTeaser: "A candid account of the acquisition talks",
  nodeUrl: "https://my-owner-node.example.workers.dev/mcp",
  apiKeyLike: "sk-ant-api03-thisisatotallyrealsecretkeyvalue1234567890"
};

function serialize(attrs: Record<string, unknown>): string {
  return JSON.stringify(attrs);
}

it("builds the expected attributes for each kind of span", () => {
  expect(toolSpanAttributes({ tool: "get", outcome: "not_found", paid: true })).toEqual({
    "lore.tool": "get", "lore.outcome": "not_found", "lore.paid": true
  });
  expect(settlementSpanAttributes({ settled: true, outcome: "ledger_failed" })).toEqual({
    "lore.settled": true, "lore.outcome": "ledger_failed"
  });
  expect(answerSpanAttributes({ model: "gpt-5.6-luna", inputTokens: 20, outputTokens: 5, costUsd: 0.01, toolCalls: 1, durationMs: 10 })).toEqual({
    "lore.answer.model": "gpt-5.6-luna", "lore.answer.input_tokens": 20,
    "lore.answer.output_tokens": 5, "lore.answer.cost_usd": 0.01,
    "lore.answer.tool_calls": 1, "lore.answer.duration_ms": 10
  });
});

function hashId(itemId: string) {
  return toolSpanAttributes({ tool: "get", outcome: "ok", itemId })["lore.item_hash"];
}

describe("hashId", () => {
  it("is stable for the same input", () => {
    expect(hashId("0000000000000000fcdb4b42")).toBe(hashId("0000000000000000fcdb4b42"));
  });

  it("is fixed-length and never equal to its input", () => {
    const hashed = hashId(SECRETS.walletAddress);
    expect(hashed).toHaveLength(16);
    expect(hashed).not.toBe(SECRETS.walletAddress);
  });

  it("differs for different inputs", () => {
    expect(hashId("a")).not.toBe(hashId("b"));
  });
});

describe("the leak table — nothing sensitive ever reaches a span attribute", () => {
  it.each(Object.entries(SECRETS))("a %s never appears verbatim when passed as an item id", (_name, secret) => {
    const attrs = toolSpanAttributes({ tool: "get", outcome: "ok", itemId: secret });
    expect(serialize(attrs)).not.toContain(secret);
  });

  it("answerSpanAttributes has no field for the buyer's question", () => {
    const attrs = answerSpanAttributes({
      model: "claude-sonnet-5",
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 0,
      toolCalls: 0,
      durationMs: 0
    });
    expect(serialize(attrs)).not.toContain(SECRETS.buyerQuestion);
    expect(Object.keys(attrs).some((key) => key.includes("question"))).toBe(false);
  });

  it("settlementSpanAttributes has no field for a payer address or a transaction hash", () => {
    const attrs = settlementSpanAttributes({ settled: true, outcome: "ok" });
    expect(Object.keys(attrs)).not.toContain("lore.payer");
    expect(Object.keys(attrs)).not.toContain("lore.tx");
    expect(serialize(attrs)).not.toContain(SECRETS.walletAddress);
    expect(serialize(attrs)).not.toContain(SECRETS.transactionHash);
  });
});

describe("telemetry failures preserve the operation", () => {
  it.each([undefined, "start", "attributes", "end"] as const)("does not retry a failed operation with tracing failure %s", async (failure) => {
    captureSpans(failure);
    const error = new Error("business failure");
    const operation = vi.fn(() => { throw error; });
    await expect(withSpan("lore.get", operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("drops invalid attributes without logging sensitive values or losing the result", async () => {
    const spans = captureSpans();
    const log = vi.spyOn(console, "error");
    await expect(withSpan("lore.get", (set) => {
      set(() => toolSpanAttributes({ tool: SECRETS.buyerQuestion as never, outcome: "ok" }));
      return "paid result";
    })).resolves.toBe("paid result");
    expect(spans[0].attributes).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });
});

describe("attribute values", () => {
  const telemetry = { model: "claude-sonnet-5", inputTokens: 1, outputTokens: 1, costUsd: 0, toolCalls: 0, durationMs: 0 };
  it.each(Object.entries(SECRETS))("rejects %s in every un-hashed input field", (_name, secret) => {
    expect(() => toolSpanAttributes({ tool: secret as never, outcome: "ok" })).toThrow();
    expect(() => toolSpanAttributes({ tool: "get", outcome: secret as never })).toThrow();
    expect(() => toolSpanAttributes({ tool: "get", outcome: "ok", paid: secret as never })).toThrow();
    expect(() => settlementSpanAttributes({ settled: secret as never, outcome: "ok" })).toThrow();
    for (const key of Object.keys(telemetry)) {
      expect(() => answerSpanAttributes({ ...telemetry, [key]: secret })).toThrow();
    }
  });
  it.each([NaN, Infinity, -1])("rejects invalid metric %s", (value) => {
    expect(() => answerSpanAttributes({ ...telemetry, costUsd: value })).toThrow();
  });
});
