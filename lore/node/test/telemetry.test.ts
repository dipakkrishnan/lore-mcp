// A tracing failure never costs a buyer their result (XC-030/MON-020, docs/telemetry.md).
// This half needs the Worker's `tracing` (src/tracing.ts imports cloudflare:workers); the
// attribute schema itself is test/unit/telemetry.test.ts, in plain node.
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolSpanAttributes } from "../src/telemetry";
import { withSpan } from "../src/tracing";
import { captureSpans } from "./tracing";

afterEach(() => vi.restoreAllMocks());

// Buyer content: the one thing a call site could pass that must never be logged on its way out.
const BUYER_QUESTION = "What is my ex's phone number and address?";

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
      set(() => toolSpanAttributes({ tool: BUYER_QUESTION as never, outcome: "ok" }));
      return "paid result";
    })).resolves.toBe("paid result");
    expect(spans[0].attributes).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });
});
