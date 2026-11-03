// The payment rail's way into the bid book (MON-054). Checkout reaches this entrypoint over a
// service binding, never over HTTP, so no route, token or person can save a card or fill a bid.
import { WorkerEntrypoint } from "cloudflare:workers";

const ID = /^[a-z0-9]{10}$/;
const STRIPE_ID = (prefix) => new RegExp(`^${prefix}_[A-Za-z0-9_]+$`);

export class BidRail extends WorkerEntrypoint {
  get book() {
    return this.env.BIDS.get(this.env.BIDS.idFromName("book"));
  }

  /** Stripe saved the buyer's card for this bid. */
  cardSaved(bid, { customer, payment_method }) {
    if (!ID.test(bid) || !STRIPE_ID("cus").test(customer) || !STRIPE_ID("pm").test(payment_method)) return false;
    return this.book.cardSaved(bid, { customer, payment_method });
  }

  /** Stripe settled a bid's charge on the seller's account: "filled", "pending" (try again) or "rejected". */
  paid(bid, { payment_intent, charge, amount_cents, currency, account }) {
    if (!ID.test(bid) || !STRIPE_ID("pi").test(payment_intent) || !STRIPE_ID("(ch|py)").test(charge) || !STRIPE_ID("acct").test(account) || !Number.isInteger(amount_cents)) return "rejected";
    return this.book.paid(bid, { payment_intent, charge, amount_cents, currency, account });
  }

  /** Stripe failed or canceled a bid's charge after it was sent: "declined", "pending" (try again) or "rejected". */
  failed(bid, { payment_intent, account, message }) {
    if (!ID.test(bid) || !STRIPE_ID("pi").test(payment_intent) || !STRIPE_ID("acct").test(account) || typeof message !== "string") return "rejected";
    return this.book.failed(bid, { payment_intent, account, message: message.slice(0, 200) });
  }
}
