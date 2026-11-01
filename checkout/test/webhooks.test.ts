import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signed } from "../src/webhooks";
import { ACCOUNT, PIECE, STORE, stub } from "./stubs";

/** Must match the `STRIPE_WEBHOOK_SECRET` override in vitest.config.ts. */
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
  it("accepts Stripe's own signing and refuses a wrong secret, a stale timestamp, or a tampered body", async () => {
    const body = event();
    expect(await signed(body, await signature(body), SECRET)).toBe(true);
    expect(await signed(body, await signature(body, "whsec_someone_else"), SECRET)).toBe(false);
    expect(await signed(body, await signature(body, SECRET, Math.floor(Date.now() / 1000) - 600), SECRET)).toBe(false);
    expect(await signed(`${body} `, await signature(body), SECRET)).toBe(false);
    expect(await signed(body, "", SECRET)).toBe(false);
    expect(await signed(body, await signature(body), "")).toBe(false);
  });

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
  it("accepts a signature exactly at the five-minute tolerance and refuses one a second past it either way", async () => {
    const body = event();
    const t = 1_800_000_000;
    const header = await signature(body, SECRET, t);
    expect(await signed(body, header, SECRET, t + 300)).toBe(true);
    expect(await signed(body, header, SECRET, t - 300)).toBe(true);
    expect(await signed(body, header, SECRET, t + 301)).toBe(false);
    expect(await signed(body, header, SECRET, t - 301)).toBe(false);
  });

  it("accepts any one valid v1 among several, as Stripe sends while a secret is rolled", async () => {
    const body = event();
    const t = Math.floor(Date.now() / 1000);
    const good = (await signature(body, SECRET, t)).split(",")[1];
    const other = (await signature(body, "whsec_old_secret", t)).split(",")[1];
    expect(await signed(body, `t=${t},${other},${good}`, SECRET)).toBe(true);
    expect(await signed(body, `t=${t},${other}`, SECRET)).toBe(false);
  });

  it("refuses a header with no timestamp, a v1 with no value, or a v1 that isn't 64 hex characters", async () => {
    const body = event();
    const t = Math.floor(Date.now() / 1000);
    const good = (await signature(body, SECRET, t)).split(",")[1];
    expect(await signed(body, good, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},v1`, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},${good.toUpperCase().replace("V1", "v1")}`, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},${good.slice(0, -2)}`, SECRET)).toBe(false);
  });

  it("refuses a timestamp that isn't a number, even signed over what the verifier would then compute", async () => {
    const body = event();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const overNaN = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`NaN.${body}`)));
    expect(await signed(body, `t=soon,v1=${overNaN}`, SECRET)).toBe(false);
  });

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
