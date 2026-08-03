import { vi } from "vitest";

// Must match the `LORE_FACILITATOR_URL` override in vitest.config.ts.
export const FACILITATOR_URL = "https://facilitator.test";
const SUPPORTED_KIND = { x402Version: 2, scheme: "exact", network: "eip155:84532" };

/** One canned reply for a single `/verify` or `/settle` call. */
export type FacilitatorReply =
  | { kind: "ok" }
  | { kind: "rejected"; reason?: string }
  | { kind: "http-error"; status?: number }
  // No response ever arrives — models a facilitator timeout or dropped
  // connection, which surfaces to callers as a rejected `fetch()`.
  | { kind: "unreachable" };

interface MockFacilitatorOptions {
  /** Behavior for `/verify` calls, consumed in order; the last entry repeats. */
  verify?: FacilitatorReply | FacilitatorReply[];
  /** Behavior for `/settle` calls, consumed in order; the last entry repeats. */
  settle?: FacilitatorReply | FacilitatorReply[];
}

function nextReply(queue: FacilitatorReply[], index: number): FacilitatorReply {
  return queue[Math.min(index, queue.length - 1)] ?? { kind: "ok" };
}

type RespondableReply = Exclude<FacilitatorReply, { kind: "unreachable" }>;

function verifyResponse(reply: RespondableReply): Response {
  if (reply.kind === "ok") return Response.json({ isValid: true, payer: "0xfixturepayer" });
  if (reply.kind === "rejected") {
    return Response.json({ isValid: false, invalidReason: reply.reason ?? "rejected" });
  }
  return Response.json({ error: "facilitator error" }, { status: reply.status ?? 502 });
}

function settleResponse(reply: RespondableReply): Response {
  if (reply.kind === "ok") {
    return Response.json({
      success: true,
      transaction: "0xfixturetransaction",
      network: SUPPORTED_KIND.network
    });
  }
  if (reply.kind === "rejected") {
    return Response.json({
      success: false,
      errorReason: reply.reason ?? "rejected",
      transaction: "",
      network: SUPPORTED_KIND.network
    });
  }
  return Response.json({ error: "facilitator error" }, { status: reply.status ?? 502 });
}

/**
 * Stubs the outbound HTTP calls `agents/x402`'s `HTTPFacilitatorClient` makes
 * (`GET /supported`, `POST /verify`, `POST /settle`) so the paid path runs
 * with no real network, wallet, or faucet funds. Call once per test; restore
 * with `vi.restoreAllMocks()` in `afterEach`.
 */
export function mockFacilitator(options: MockFacilitatorOptions = {}) {
  const verifyQueue = ([] as FacilitatorReply[]).concat(options.verify ?? { kind: "ok" });
  const settleQueue = ([] as FacilitatorReply[]).concat(options.settle ?? { kind: "ok" });
  let verifyCalls = 0;
  let settleCalls = 0;

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.origin !== new URL(FACILITATOR_URL).origin) {
      throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
    }

    if (request.method === "GET" && url.pathname === "/supported") {
      return Response.json({ kinds: [SUPPORTED_KIND], extensions: [], signers: {} });
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      const reply = nextReply(verifyQueue, verifyCalls++);
      if (reply.kind === "unreachable") throw new Error("simulated facilitator timeout");
      return verifyResponse(reply);
    }

    if (request.method === "POST" && url.pathname === "/settle") {
      const reply = nextReply(settleQueue, settleCalls++);
      if (reply.kind === "unreachable") throw new Error("simulated facilitator timeout");
      return settleResponse(reply);
    }

    throw new Error(`unexpected facilitator request: ${request.method} ${url.pathname}`);
  });
}
