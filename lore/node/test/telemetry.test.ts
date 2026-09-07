// The allowlist is the whole privacy contract for XC-030/MON-020: every
// attribute a span can carry is enumerated here, and these tests are what
// enforces it — not review discipline. See docs/telemetry.md.
import { describe, expect, it } from "vitest";
import {
  OUTCOMES,
  answerSpanAttributes,
  hashId,
  isKnownAttribute,
  settlementSpanAttributes,
  toolSpanAttributes
} from "../src/telemetry";

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

describe("the attribute allowlist", () => {
  it("every key toolSpanAttributes produces is in the allowlist", () => {
    for (const outcome of OUTCOMES) {
      const attrs = toolSpanAttributes({ tool: "get", outcome, paid: true, itemId: "abc123" });
      for (const key of Object.keys(attrs)) expect(isKnownAttribute(key)).toBe(true);
    }
  });

  it("every key settlementSpanAttributes produces is in the allowlist", () => {
    for (const outcome of OUTCOMES) {
      const attrs = settlementSpanAttributes({ settled: outcome === "ok", outcome });
      for (const key of Object.keys(attrs)) expect(isKnownAttribute(key)).toBe(true);
    }
  });

  it("every key answerSpanAttributes produces is in the allowlist", () => {
    const attrs = answerSpanAttributes({
      model: "claude-sonnet-5",
      inputTokens: 2000,
      outputTokens: 400,
      costUsd: 0.008,
      toolCalls: 2,
      durationMs: 5100
    });
    for (const key of Object.keys(attrs)) expect(isKnownAttribute(key)).toBe(true);
  });

  it("rejects an outcome outside the closed vocabulary rather than silently forwarding it", () => {
    expect(() => toolSpanAttributes({ tool: "get", outcome: "made-up-outcome" as never })).toThrow();
  });
});

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
