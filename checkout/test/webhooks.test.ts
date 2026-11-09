// What the Worker does with a Stripe delivery. The signature check itself, `signed`, is pure and
// tested in test/unit/signed.test.ts (XC-099); here only its two refusals that reach the handler.
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT, PIECE, STORE, stub } from "./stubs";

/** Must match the `STRIPE_WEBHOOK_SECRET` override in vitest.workerd.config.ts. */
const SECRET = "whsec_test_not_a_real_secret";

afterEach(() => {
  vi.restoreAllMocks();
});

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Signs like Stripe: HMAC-SHA256 of `<t>.<body>` under the endpoint secret. */
async function signature(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${timestamp},v1=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))}`;
}

const event = (overrides: Record<string, unknown> = {}, session: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "checkout.session.completed",
    account: ACCOUNT,
    data: { object: { id: "cs_test_abc", payment_status: "paid", metadata: { origin: STORE, piece: PIECE }, ...session } },
    ...overrides
  });

const deliver = async (body: string, header?: string) =>
  exports.default.fetch("https://checkout.test/webhooks", {
    method: "POST",
    body,
    headers: { "stripe-signature": header ?? (await signature(body)) }
  });

const notices = (calls: { url: string; body: string }[]) => calls.filter((call) => call.url.endsWith("/paid"));

describe("Stripe's signature", () => {
  it("drops an unsigned delivery before telling any store", async () => {
    const calls = stub();
    const response = await deliver(event(), "t=1,v1=00");
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("a paid checkout", () => {
  it("tells the store the account is tied to, naming only the session", async () => {
    const calls = stub();
    const response = await deliver(event());
    expect(response.status).toBe(200);
    const [notice] = notices(calls);
    expect(notice.url).toBe(`${STORE}/p/${PIECE}/paid`);
    expect(Object.fromEntries(new URLSearchParams(notice.body))).toEqual({ session_id: "cs_test_abc" });
  });

  it("counts an async payment once it succeeds", async () => {
    const calls = stub();
    expect((await deliver(event({ type: "checkout.session.async_payment_succeeded" }))).status).toBe(200);
    expect(notices(calls)).toHaveLength(1);
  });

  it("tells no store about a session whose account is tied to another store", async () => {
    const calls = stub({ boundTo: "https://real-seller.test" });
    expect((await deliver(event())).status).toBe(200);
    expect(notices(calls)).toEqual([]);
  });

  it("ignores unpaid sessions and other events", async () => {
    const calls = stub();
    expect((await deliver(event({}, { payment_status: "unpaid" }))).status).toBe(200);
    expect((await deliver(event({ type: "customer.created" }))).status).toBe(200);
    expect(notices(calls)).toEqual([]);
  });

  it("asks Stripe to retry when the store can't take the sale yet", async () => {
    stub({ noticeStatus: 503 });
    expect((await deliver(event())).status).toBe(502);
  });
});

describe("Stripe's signature, at its edges", () => {
  it("drops a delivery with no Stripe-Signature header at all", async () => {
    const calls = stub();
    const response = await exports.default.fetch("https://checkout.test/webhooks", { method: "POST", body: event() });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ outcome: "unsigned" });
    expect(calls).toEqual([]);
  });
});

describe("a paid checkout, past the happy path", () => {
  it("acknowledges and drops a paid session that isn't a Lore sale, telling no store", async () => {
    const calls = stub();
    const notLore = [
      event({ account: undefined }),
      event({ account: "acct_x/../y" }),
      event({}, { metadata: undefined }),
      event({}, { metadata: { origin: STORE } }),
      event({}, { metadata: { origin: STORE, piece: "../admin" } }),
      event({}, { id: undefined }),
      event({}, { id: "pi_123" })
    ];
    for (const body of notLore) {
      const response = await deliver(body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: "not a Lore sale" });
    }
    expect(calls).toEqual([]);
  });

  it("says which outcome each delivery had", async () => {
    stub();
    expect(await (await deliver(event())).json()).toEqual({ outcome: "recorded" });
    expect(await (await deliver(event({ type: "customer.created" }))).json()).toEqual({ outcome: "ignored" });
    stub({ boundTo: "https://real-seller.test" });
    expect(await (await deliver(event())).json()).toEqual({ outcome: "not this account's store" });
    stub({ noticeStatus: 503 });
    expect(await (await deliver(event())).json()).toEqual({ outcome: "store refused" });
  });

  it("asks Stripe to retry when the store can't be reached, or Stripe can't say which store the account is tied to", async () => {
    const calls = stub({ noticeThrows: true });
    let response = await deliver(event());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ outcome: "store unreachable" });
    expect(notices(calls)).toHaveLength(1);
    // A Stripe outage reads the same as an unreachable store.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stripe = stub({ stripeStatus: 500 });
    response = await deliver(event());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ outcome: "store unreachable" });
    expect(notices(stripe)).toEqual([]);
  });

  it("pins today's behaviour: an account tied to no store and a sale naming no store asks Stripe to retry forever", async () => {
    // boundStore answers "" and the event's origin is "", so the check passes and
    // the notice goes to a relative URL, which throws. Reported, not fixed here.
    const calls = stub({ boundTo: "" });
    const response = await deliver(event({}, { metadata: { piece: PIECE } }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ outcome: "store unreachable" });
    expect(notices(calls)).toEqual([]);
  });
});
