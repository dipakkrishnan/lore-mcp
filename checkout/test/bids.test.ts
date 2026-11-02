import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT, PIECE, STORE, STRIPE_API, listing } from "./stubs";

/** Must match the overrides in vitest.config.ts. */
const CONNECT_SECRET = "whsec_test_not_a_real_secret";
const PLATFORM_SECRET = "whsec_test_platform_not_a_real_secret";
const BID = "k3v9q2m7xa";
const PIECE_URL = `${STORE}/p/${PIECE}`;
const CHARGE = { bid: BID, attempt: `bid-${BID}-7`, customer: "cus_buyer", payment_method: "pm_saved", piece_url: PIECE_URL, usd_cents: 2000, question: "How do you stop reward hacking?" };

type Sent = { url: string; method: string; headers: Headers; body: URLSearchParams };
type Rail = { told(): Promise<Record<string, [string, Record<string, unknown>]>[]>; forget(): Promise<void> };
const rail = () => env.BIDS_RAIL as unknown as Rail;

type Options = { store?: ReturnType<typeof listing> | null; boundTo?: string; charge?: { status: number; body: unknown }; setup?: Record<string, unknown>; noticeStatus?: number };

/** Stripe and the seller's store, stubbed. Every Stripe request is recorded; anything unexpected throws. */
function stripe({ store = listing(), boundTo = STORE, charge, setup = {}, noticeStatus = 200 }: Options = {}) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const record = async () => sent.push({ url: request.url, method: request.method, headers: request.headers, body: new URLSearchParams(await request.text()) });
    if (url.origin === STORE && path === `/p/${PIECE}.json`) return store ? Response.json(store) : new Response("", { status: 404 });
    if (url.origin === STORE && path === `/p/${PIECE}/paid`) {
      await record();
      return Response.json({}, { status: noticeStatus });
    }
    if (url.origin !== STRIPE_API) throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
    await record();
    if (path.startsWith("/v2/core/accounts/")) return Response.json({ id: ACCOUNT, metadata: { lore_store: boundTo } });
    if (path === "/v1/customers") return Response.json({ id: "cus_new" });
    if (path === "/v1/checkout/sessions") return Response.json({ id: "cs_test_setup", url: "https://checkout.stripe.test/c/setup/cs_test_setup" });
    if (path.startsWith("/v1/setup_intents/")) return Response.json({ status: "succeeded", customer: "cus_buyer", payment_method: "pm_saved", metadata: { lore_bid: BID }, ...setup });
    if (path === "/v1/payment_methods") return Response.json({ id: "pm_cloned" });
    if (path === "/v1/payment_intents") return charge ? Response.json(charge.body, { status: charge.status }) : Response.json({ id: "pi_bid", status: "succeeded", amount_received: 2000, currency: "usd", latest_charge: "ch_bid", metadata: {} });
    if (path.startsWith("/v1/payment_intents/")) return Response.json({ id: "pi_bid", status: "succeeded", amount_received: 2000, latest_charge: "ch_bid", metadata: { origin: STORE, piece: PIECE, lore_bid: BID } });
    throw new Error(`unexpected Stripe call during test: ${request.method} ${path}`);
  });
  return sent;
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function signature(body: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${timestamp},v1=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))}`;
}
const deliver = async (event: Record<string, unknown>, secret: string) => {
  const body = JSON.stringify(event);
  return exports.default.fetch("https://checkout.test/webhooks", { method: "POST", body, headers: { "stripe-signature": await signature(body, secret) } });
};

const setupDone = (overrides: Record<string, unknown> = {}) => ({
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_setup", mode: "setup", payment_status: "no_payment_required", setup_intent: "seti_1", metadata: { lore_bid: BID }, ...overrides } }
});
const bidPaid = (overrides: Record<string, unknown> = {}, bid = BID, type = "payment_intent.succeeded") => ({
  type,
  account: ACCOUNT,
  data: { object: { id: "pi_bid", amount_received: 2000, currency: "usd", latest_charge: "ch_bid", metadata: { lore_bid: bid, origin: STORE, piece: PIECE }, ...overrides } }
});

beforeEach(async () => rail().forget());
afterEach(() => vi.restoreAllMocks());

describe("saving a bidder's card", () => {
  it("makes a platform customer and a setup-mode Checkout page that charges nothing", async () => {
    const sent = stripe();
    const { url } = await exports.BidCards.setup({ bid: BID, question: "How?", customer: null, return_url: `https://yourlore.dev/b/${BID}` });
    expect(url).toBe("https://checkout.stripe.test/c/setup/cs_test_setup");
    expect(sent.map((s) => s.headers.get("stripe-account"))).toEqual([null, null]);
    expect(sent[0].headers.get("idempotency-key")).toBe(`bid-${BID}-customer`);
    const session = Object.fromEntries(sent[1].body);
    expect(session).toMatchObject({ mode: "setup", currency: "usd", customer: "cus_new", "setup_intent_data[metadata][lore_bid]": BID, success_url: `https://yourlore.dev/b/${BID}` });
    expect(session).not.toHaveProperty("payment_method_types[0]");
  });

  it("reuses the buyer's customer when they replace a card, and answers null when Stripe can't", async () => {
    const sent = stripe();
    await exports.BidCards.setup({ bid: BID, question: "How?", customer: "cus_buyer", return_url: "https://yourlore.dev/b/x" });
    expect(sent.map((s) => new URL(s.url).pathname)).toEqual(["/v1/checkout/sessions"]);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { message: "down" } }, { status: 500 }));
    expect(await exports.BidCards.setup({ bid: BID, question: "How?", customer: null, return_url: "https://yourlore.dev/b/x" })).toEqual({ url: null });
  });

  it("tells the bid book once Stripe confirms the platform's setup, signed with the platform secret", async () => {
    stripe();
    const response = await deliver(setupDone(), PLATFORM_SECRET);
    expect(await response.json()).toEqual({ outcome: "card saved" });
    expect(await rail().told()).toEqual([{ cardSaved: [BID, { customer: "cus_buyer", payment_method: "pm_saved" }] }]);
  });

  it("tells it nothing for a setup that didn't succeed or belongs to another bid", async () => {
    stripe({ setup: { status: "requires_payment_method", payment_method: null } });
    expect(await (await deliver(setupDone(), PLATFORM_SECRET)).json()).toEqual({ outcome: "no card saved" });
    vi.restoreAllMocks();
    stripe({ setup: { metadata: { lore_bid: "zzzzzzzzzz" } } });
    expect(await (await deliver(setupDone(), PLATFORM_SECRET)).json()).toEqual({ outcome: "no card saved" });
    expect(await rail().told()).toEqual([]);
  });
});

describe("charging an accepted answer", () => {
  it("clones the card onto the seller's account and charges it there, off session, once per attempt", async () => {
    const sent = stripe();
    expect(await exports.BidCards.charge(CHARGE)).toEqual({ ok: true, payment_intent: "pi_bid", account: ACCOUNT });
    const [clone, intent] = sent.filter((s) => s.url.includes("/v1/payment_"));
    expect(clone.headers.get("stripe-account")).toBe(ACCOUNT);
    expect(Object.fromEntries(clone.body)).toEqual({ customer: "cus_buyer", payment_method: "pm_saved" });
    expect(clone.headers.get("idempotency-key")).toBe(`bid-${BID}-7-card`);
    expect(intent.headers.get("stripe-account")).toBe(ACCOUNT);
    expect(intent.headers.get("idempotency-key")).toBe(`bid-${BID}-7`);
    expect(Object.fromEntries(intent.body)).toMatchObject({
      amount: "2000",
      currency: "usd",
      payment_method: "pm_cloned",
      confirm: "true",
      off_session: "true",
      "metadata[lore_bid]": BID,
      "metadata[lore_attempt]": `bid-${BID}-7`,
      "metadata[origin]": STORE,
      "metadata[piece]": PIECE
    });
    expect(intent.body.has("application_fee_amount")).toBe(false);
  });

  it("says a decline and a bank's confirmation plainly, and a Stripe outage is a retry", async () => {
    stripe({ charge: { status: 402, body: { error: { code: "card_declined", decline_code: "insufficient_funds" } } } });
    expect(await exports.BidCards.charge(CHARGE)).toEqual({ ok: false, reason: "card_declined", message: "Your card was declined." });
    vi.restoreAllMocks();
    stripe({ charge: { status: 402, body: { error: { code: "authentication_required" } } } });
    expect(await exports.BidCards.charge(CHARGE)).toEqual({ ok: false, reason: "authentication_required", message: "Your bank wants to confirm this payment." });
    vi.restoreAllMocks();
    stripe({ charge: { status: 200, body: { id: "pi_bid", status: "requires_action" } } });
    expect(await exports.BidCards.charge(CHARGE)).toMatchObject({ ok: false, reason: "authentication_required" });
    vi.restoreAllMocks();
    stripe({ charge: { status: 503, body: { error: {} } } });
    expect(await exports.BidCards.charge(CHARGE)).toEqual({ ok: false, retry: true });
  });

  it("charges no one when the piece's store doesn't take cards into an account tied to it", async () => {
    const cases: Options[] = [{ store: null }, { store: listing({ stripe_account: "" }) }, { boundTo: "https://someone-else.test" }];
    for (const options of cases) {
      const sent = stripe(options);
      expect(await exports.BidCards.charge(CHARGE)).toMatchObject({ ok: false, reason: "seller" });
      expect(sent.filter((s) => s.url.includes("/v1/payment_"))).toEqual([]);
      vi.restoreAllMocks();
    }
    stripe();
    expect(await exports.BidCards.charge({ ...CHARGE, piece_url: "https://store.test/not-a-piece" })).toMatchObject({ ok: false, reason: "seller" });
  });
});

describe("a bid's settled charge", () => {
  it("fills the bid over the rail and counts the sale in the seller's store, retries included", async () => {
    const sent = stripe();
    expect(await (await deliver(bidPaid(), CONNECT_SECRET)).json()).toEqual({ outcome: "bid filled" });
    expect(await (await deliver(bidPaid(), CONNECT_SECRET)).json()).toEqual({ outcome: "bid filled" });
    const told = await rail().told();
    expect(told[0]).toEqual({ paid: [BID, { payment_intent: "pi_bid", charge: "ch_bid", amount_cents: 2000, currency: "usd", account: ACCOUNT }] });
    expect(sent.filter((s) => s.url.endsWith("/paid")).map((s) => s.body.get("session_id"))).toEqual(["pi_bid", "pi_bid"]);
  });

  it("fills a real charge even when the seller rebinds the account between the charge and Stripe's report", async () => {
    const sent = stripe({ boundTo: "https://someone-else.test", noticeStatus: 404 });
    expect(await (await deliver(bidPaid(), CONNECT_SECRET)).json()).toEqual({ outcome: "bid filled" });
    expect(await rail().told()).toEqual([{ paid: [BID, { payment_intent: "pi_bid", charge: "ch_bid", amount_cents: 2000, currency: "usd", account: ACCOUNT }] }]);
    // Nothing reads the current binding to decide this; the bid book checks the charge-time record.
    expect(sent.filter((s) => s.url.includes("/v2/core/accounts"))).toEqual([]);
  });

  it("asks Stripe again only when the seller's store couldn't answer", async () => {
    stripe({ noticeStatus: 503 });
    expect((await deliver(bidPaid(), CONNECT_SECRET)).status).toBe(502);
  });

  it("fills nothing for an event Lore didn't make", async () => {
    stripe();
    expect(await (await deliver(bidPaid({ metadata: {} }), CONNECT_SECRET)).json()).toEqual({ outcome: "ignored" });
    expect(await (await deliver(bidPaid({ latest_charge: null }), CONNECT_SECRET)).json()).toEqual({ outcome: "not a Lore bid charge" });
    expect(await rail().told()).toEqual([]);
  });

  it("refuses an event signed by neither endpoint", async () => {
    stripe();
    expect((await deliver(bidPaid(), "whsec_someone_else")).status).toBe(400);
    expect(await rail().told()).toEqual([]);
  });

  it("takes each secret only for its own events: the platform's for saved cards, Connect's for sellers' payments", async () => {
    const sent = stripe();
    expect(await (await deliver(bidPaid(), PLATFORM_SECRET)).json()).toEqual({ outcome: "ignored" });
    expect(await (await deliver(bidPaid({}, BID, "payment_intent.payment_failed"), PLATFORM_SECRET)).json()).toEqual({ outcome: "ignored" });
    expect(await (await deliver(setupDone(), CONNECT_SECRET)).json()).toEqual({ outcome: "ignored" });
    expect(await (await deliver({ ...setupDone(), account: ACCOUNT }, PLATFORM_SECRET)).json()).toEqual({ outcome: "ignored" });
    expect(await rail().told()).toEqual([]);
    expect(sent.filter((s) => s.url.endsWith("/paid"))).toEqual([]);
  });

  it("tells the store nothing when the bid book doesn't fill, and asks Stripe to retry when it isn't ready", async () => {
    const sent = stripe();
    expect(await (await deliver(bidPaid({}, "rejectedbd"), CONNECT_SECRET)).json()).toEqual({ outcome: "not this bid's charge" });
    const early = await deliver(bidPaid({}, "pendingbid"), CONNECT_SECRET);
    expect(early.status).toBe(503);
    expect(sent.filter((s) => s.url.endsWith("/paid"))).toEqual([]);
  });

  it("turns a charge that fails or is canceled later into a plain decline for the bid book", async () => {
    stripe();
    const failed = await deliver(bidPaid({ last_payment_error: { code: "card_declined" } }, BID, "payment_intent.payment_failed"), CONNECT_SECRET);
    expect(await failed.json()).toEqual({ outcome: "bid declined" });
    await deliver(bidPaid({ last_payment_error: { code: "authentication_required" } }, BID, "payment_intent.payment_failed"), CONNECT_SECRET);
    await deliver(bidPaid({}, BID, "payment_intent.canceled"), CONNECT_SECRET);
    expect((await rail().told()).map((t) => t.failed)).toEqual([
      [BID, { payment_intent: "pi_bid", account: ACCOUNT, message: "Your card was declined." }],
      [BID, { payment_intent: "pi_bid", account: ACCOUNT, message: "Your bank wants to confirm this payment." }],
      [BID, { payment_intent: "pi_bid", account: ACCOUNT, message: "Your card couldn't be charged." }]
    ]);
    expect((await deliver(bidPaid({}, "pendingbid", "payment_intent.payment_failed"), CONNECT_SECRET)).status).toBe(503);
  });

  it("opens the piece for the buyer: /verify reads a bid's payment like a Checkout Session", async () => {
    stripe();
    const response = await exports.default.fetch(`https://checkout.test/verify?session=pi_bid&account=${ACCOUNT}`);
    expect(await response.json()).toEqual({ paid: true, piece: PIECE, origin: STORE, payment_intent: "pi_bid", amount_usd: 20 });
  });
});
