// XC-102: which of Stripe's signed events checkout acts on, and what it takes from them, as tables.
// What each route then does (the bid book, the store's paid notice) is test/webhooks.test.ts.
import { describe, expect, it } from "vitest";
import { type Event, bidCharge, failureMessage, route } from "../../src/events";
import { ACCOUNT, PIECE, STORE } from "../stubs";

const BID = "bid0000001";

type Object = Event["data"]["object"];
const event = (type: string, object: Object, account: string | null = ACCOUNT): Event => ({ type, ...(account === null ? {} : { account }), data: { object } });

const paidSession: Object = { id: "cs_test_abc", payment_status: "paid", metadata: { origin: STORE, piece: PIECE } };
const setupSession: Object = { id: "cs_test_setup", mode: "setup", setup_intent: "seti_123", metadata: { lore_bid: BID } };
const bidIntent: Object = { id: "pi_test_bid", latest_charge: "ch_1", metadata: { lore_bid: BID, origin: STORE, piece: PIECE } };
const SALE = { to: "sale", account: ACCOUNT, origin: STORE, piece: PIECE, session: "cs_test_abc" };
const IGNORED = { to: "drop", outcome: "ignored" };
const NOT_A_SALE = { to: "drop", outcome: "not a Lore sale" };

describe("route, on the Connect endpoint (sellers' accounts)", () => {
  it.each<[string, Event, unknown]>([
    ["a paid Checkout Session", event("checkout.session.completed", paidSession), SALE],
    ["a delayed payment that succeeded", event("checkout.session.async_payment_succeeded", paidSession), SALE],
    ["a completed session still awaiting payment", event("checkout.session.completed", { ...paidSession, payment_status: "unpaid" }), IGNORED],
    ["a session that expired", event("checkout.session.expired", paidSession), IGNORED],
    ["a delayed payment that failed", event("checkout.session.async_payment_failed", paidSession), IGNORED],
    ["an event Stripe sends that checkout never asked for", event("account.updated", paidSession), IGNORED],
    ["a paid session with no account", event("checkout.session.completed", paidSession, null), NOT_A_SALE],
    ["a paid session on an account id that isn't one", event("checkout.session.completed", paidSession, "acct_bad-id"), NOT_A_SALE],
    ["a paid session whose id isn't a session's", event("checkout.session.completed", { ...paidSession, id: "pi_test_abc" }), NOT_A_SALE],
    ["a paid session with no id", event("checkout.session.completed", { ...paidSession, id: undefined }), NOT_A_SALE],
    ["a paid session naming no piece", event("checkout.session.completed", { ...paidSession, metadata: { origin: STORE } }), NOT_A_SALE],
    ["a paid session naming a piece that isn't one", event("checkout.session.completed", { ...paidSession, metadata: { origin: STORE, piece: "../admin" } }), NOT_A_SALE],
    // The store is checked against the account's binding when it is told, not here.
    ["a paid session naming no store", event("checkout.session.completed", { ...paidSession, metadata: { piece: PIECE } }), { ...SALE, origin: "" }],
    ["a bid's charge that settled", event("payment_intent.succeeded", bidIntent), { to: "bid paid" }],
    ["a charge that settled with no bid on it", event("payment_intent.succeeded", { ...bidIntent, metadata: { origin: STORE, piece: PIECE } }), IGNORED],
    ["a charge that settled with an empty bid", event("payment_intent.succeeded", { ...bidIntent, metadata: { lore_bid: "" } }), IGNORED],
    ["a bid's charge that failed", event("payment_intent.payment_failed", bidIntent), { to: "bid failed" }],
    ["a bid's charge that was canceled", event("payment_intent.canceled", bidIntent), { to: "bid failed" }],
    ["a charge that failed with no bid on it", event("payment_intent.payment_failed", { ...bidIntent, metadata: {} }), IGNORED],
    ["a bid's charge that needs action", event("payment_intent.requires_action", bidIntent), IGNORED],
    // A saved card is the platform endpoint's alone, even when the Connect secret signs one.
    ["a saved bid card", event("checkout.session.completed", setupSession, null), IGNORED]
  ])("%s", (_, given, expected) => {
    expect(route(given, false)).toEqual(expected);
  });
});

describe("route, on the platform endpoint (Lore's own account)", () => {
  const CARD = { to: "card saved", bid: BID, setupIntent: "seti_123" };
  it.each<[string, Event, unknown]>([
    ["a bid buyer's saved card", event("checkout.session.completed", setupSession, null), CARD],
    ["a saved card on a seller's account", event("checkout.session.completed", setupSession), IGNORED],
    ["a payment-mode session", event("checkout.session.completed", { ...setupSession, mode: "payment" }, null), IGNORED],
    ["a setup session that isn't completed", event("checkout.session.expired", setupSession, null), IGNORED],
    ["a saved card with no bid", event("checkout.session.completed", { ...setupSession, metadata: {} }, null), IGNORED],
    ["a saved card naming a bid that isn't one", event("checkout.session.completed", { ...setupSession, metadata: { lore_bid: "BID-1" } }, null), IGNORED],
    ["a saved card with no setup intent", event("checkout.session.completed", { ...setupSession, setup_intent: undefined }, null), IGNORED],
    // The platform secret never signs a seller's sale or a bid's charge.
    ["a paid Checkout Session", event("checkout.session.completed", paidSession, null), IGNORED],
    ["a bid's charge that settled", event("payment_intent.succeeded", bidIntent, null), IGNORED]
  ])("%s", (_, given, expected) => {
    expect(route(given, true)).toEqual(expected);
  });
});

describe("bidCharge", () => {
  it("names the bid, the account, the store and the piece of a bid's direct charge", () => {
    expect(bidCharge(event("payment_intent.succeeded", bidIntent))).toEqual({
      intent: bidIntent,
      account: ACCOUNT,
      bid: BID,
      origin: STORE,
      piece: PIECE,
      id: "pi_test_bid"
    });
  });

  it.each<[string, Event]>([
    ["no account", event("payment_intent.succeeded", bidIntent, null)],
    ["an account id that isn't one", event("payment_intent.succeeded", bidIntent, "acct_")],
    ["a bid that isn't one", event("payment_intent.succeeded", { ...bidIntent, metadata: { ...bidIntent.metadata, lore_bid: "short" } })],
    ["no piece", event("payment_intent.succeeded", { ...bidIntent, metadata: { lore_bid: BID, origin: STORE } })],
    ["a piece that isn't one", event("payment_intent.succeeded", { ...bidIntent, metadata: { ...bidIntent.metadata, piece: "nope" } })],
    ["no metadata", event("payment_intent.succeeded", { ...bidIntent, metadata: undefined })],
    ["an id that isn't a PaymentIntent's", event("payment_intent.succeeded", { ...bidIntent, id: "ch_1" })],
    ["no id", event("payment_intent.succeeded", { ...bidIntent, id: undefined })]
  ])("is null for a charge with %s", (_, given) => {
    expect(bidCharge(given)).toBeNull();
  });
});

describe("failureMessage", () => {
  it.each<[string, Event, string]>([
    ["a canceled charge", event("payment_intent.canceled", bidIntent), "Your card couldn't be charged."],
    ["a canceled charge the bank had asked to confirm", event("payment_intent.canceled", { ...bidIntent, last_payment_error: { code: "authentication_required" } }), "Your card couldn't be charged."],
    ["a bank that wants to confirm", event("payment_intent.payment_failed", { ...bidIntent, last_payment_error: { code: "authentication_required" } }), "Your bank wants to confirm this payment."],
    ["a decline", event("payment_intent.payment_failed", { ...bidIntent, last_payment_error: { code: "card_declined" } }), "Your card was declined."],
    ["a failure with no reason", event("payment_intent.payment_failed", bidIntent), "Your card was declined."]
  ])("%s → %o", (_, given, expected) => {
    expect(failureMessage(given)).toBe(expected);
  });
});
