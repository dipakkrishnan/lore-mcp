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

  /** Stripe settled the accepted answer's charge on the seller's account. */
  paid(bid, { payment_intent, charge, amount_cents }) {
    if (!ID.test(bid) || !STRIPE_ID("pi").test(payment_intent) || !STRIPE_ID("(ch|py)").test(charge) || !Number.isInteger(amount_cents)) return false;
    return this.book.paid(bid, { payment_intent, charge, amount_cents });
  }
}
