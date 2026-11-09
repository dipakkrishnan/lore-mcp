/**
 * Which of Stripe's events checkout acts on, and what each one names (XC-102). webhooks.ts checks
 * the signature, asks `route` where a signed event goes, and makes the calls; nothing here reaches
 * Stripe, the bid book or a store, so test/unit/events.test.ts runs it in plain node.
 */
import { ACCOUNT, PIECE } from "./store.js";

const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const BID_FAILED = new Set(["payment_intent.payment_failed", "payment_intent.canceled"]);
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const BID = /^[a-z0-9]{10}$/;

export type Event = {
  type: string;
  account?: string;
  data: {
    object: {
      id?: string;
      mode?: string;
      payment_status?: string;
      setup_intent?: string;
      amount_received?: number;
      latest_charge?: string;
      currency?: string;
      last_payment_error?: { code?: string };
      metadata?: Record<string, string>;
    };
  };
};

/** Where a signed event goes; `drop` is acknowledged with its outcome and nothing else. */
export type Route =
  | { to: "card saved"; bid: string; setupIntent: string }
  | { to: "bid paid" }
  | { to: "bid failed" }
  | { to: "sale"; account: string; origin: string; piece: string; session: string }
  | { to: "drop"; outcome: "ignored" | "not a Lore sale" };

/**
 * The platform endpoint's secret signs only a bid buyer's saved card, an event on Lore's own
 * account; the Connect endpoint's secret signs only what happens on sellers' accounts: a bid's
 * direct charge settling or failing, and a card sale's Checkout Session being paid.
 */
export function route(event: Event, platform: boolean): Route {
  const object = event.data.object;
  if (platform) {
    const bid = object.metadata?.lore_bid ?? "";
    const setup = event.type === "checkout.session.completed" && object.mode === "setup" && !event.account;
    return setup && BID.test(bid) && object.setup_intent ? { to: "card saved", bid, setupIntent: object.setup_intent } : { to: "drop", outcome: "ignored" };
  }
  if (event.type === "payment_intent.succeeded") return object.metadata?.lore_bid ? { to: "bid paid" } : { to: "drop", outcome: "ignored" };
  if (BID_FAILED.has(event.type)) return object.metadata?.lore_bid ? { to: "bid failed" } : { to: "drop", outcome: "ignored" };
  // Anything else Stripe sends is acknowledged and dropped; a 2xx stops it retrying.
  if (!PAID_EVENTS.has(event.type) || object.payment_status !== "paid") return { to: "drop", outcome: "ignored" };
  const account = event.account ?? "";
  const origin = object.metadata?.origin ?? "";
  const piece = object.metadata?.piece ?? "";
  const session = object.id ?? "";
  if (!ACCOUNT.test(account) || !SESSION.test(session) || !PIECE.test(piece)) return { to: "drop", outcome: "not a Lore sale" };
  return { to: "sale", account, origin, piece, session };
}

/**
 * The bid charge an event names. Whether it is that bid's charge is the bid book's call, against the
 * PaymentIntent and account it recorded when the charge was made; the account's current store
 * binding is checked when charging, never here, since a seller may rebind before Stripe reports.
 */
export function bidCharge(event: Event) {
  const intent = event.data.object;
  const account = event.account ?? "";
  const { lore_bid: bid = "", origin = "", piece = "" } = intent.metadata ?? {};
  if (!ACCOUNT.test(account) || !BID.test(bid) || !PIECE.test(piece) || !intent.id?.startsWith("pi_")) return null;
  return { intent, account, bid, origin, piece, id: intent.id };
}

/** What the buyer is told when a bid's charge fails: a cancel, a bank asking to confirm, or a decline. */
export function failureMessage(event: Event): string {
  if (event.type === "payment_intent.canceled") return "Your card couldn't be charged.";
  return event.data.object.last_payment_error?.code === "authentication_required" ? "Your bank wants to confirm this payment." : "Your card was declined.";
}
