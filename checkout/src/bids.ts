/** Bids with a card behind them (MON-054). yourlore.dev's bid book calls this entrypoint over a
 * service binding: `setup` saves a buyer's card on Lore's platform when a bid is placed, and
 * `charge` pays an accepted answer as a direct charge on that answer's seller's own account.
 * What Stripe then confirms comes back through the webhook, never through these replies. */
import { WorkerEntrypoint } from "cloudflare:workers";
import { ACCOUNT, PIECE, keyFits, listing, storeOrigin } from "./store.js";
import { StripeError, boundStore, chargeBid, createCustomer, createSetupSession } from "./stripe.js";

export type Setup = { bid: string; question: string; customer: string | null; return_url: string };
export type Charge = { bid: string; attempt: string; customer: string; payment_method: string; piece_url: string; usd_cents: number; question: string };
/** `retry` means Stripe couldn't be reached and nothing was decided; the bid book sends the same attempt again. */
export type Charged = { ok: true; payment_intent: string } | { ok: false; retry: true } | { ok: false; reason: string; message: string };

const BID = /^[a-z0-9]{10}$/;
const CUSTOMER = /^cus_[A-Za-z0-9]+$/;
const ATTEMPT = /^bid-[a-z0-9]{10}-\d+$/;

const refused = (reason: string, message: string): Charged => ({ ok: false, reason, message });
const SELLER = refused("seller", "The seller can't take card payments right now.");

/** The seller's store and piece an answer links to, or null when it isn't a Lore piece. */
function pieceOf(link: string): { origin: string; piece: string } | null {
  try {
    const url = new URL(link);
    const [, piece] = url.pathname.match(/^\/p\/([0-9a-f]{24})$/) ?? [];
    const origin = storeOrigin(url.origin);
    return origin && piece && PIECE.test(piece) ? { origin, piece } : null;
  } catch {
    return null;
  }
}

/** A refusal in words the buyer acts on; Stripe being unreachable or busy is a retry, not a refusal. */
function outcome(error: unknown): Charged {
  if (!(error instanceof StripeError) || error.status >= 500 || error.status === 429) return { ok: false, retry: true };
  if (error.code === "authentication_required") return refused(error.code, "Your bank wants to confirm this payment.");
  if (error.status === 402) return refused(error.code || "card_declined", "Your card was declined.");
  return refused(error.code || "failed", "Your card couldn't be charged.");
}

export class BidCards extends WorkerEntrypoint<Env> {
  /** Stripe's page for saving the buyer's card to this bid; `url` is null when Stripe can't make one. */
  async setup({ bid, question, customer, return_url }: Setup): Promise<{ url: string | null }> {
    if (!BID.test(bid) || (customer !== null && !CUSTOMER.test(customer))) return { url: null };
    try {
      const buyer = customer ?? (await createCustomer(this.env, bid));
      return { url: (await createSetupSession(this.env, { bid, customer: buyer, question, returnUrl: return_url })).url };
    } catch {
      return { url: null };
    }
  }

  /** Charges the bid amount to the buyer's saved card, paid into the account the answer's seller tied to their store. */
  async charge(request: Charge): Promise<Charged> {
    const { bid, attempt, customer, payment_method, piece_url, usd_cents, question } = request;
    if (!BID.test(bid) || !ATTEMPT.test(attempt) || !CUSTOMER.test(customer) || !/^pm_[A-Za-z0-9_]+$/.test(payment_method)) {
      return refused("failed", "Your card couldn't be charged.");
    }
    const target = pieceOf(piece_url);
    if (!target) return refused("seller", "The answer isn't a piece that can be bought.");
    const found = await listing(target.origin, target.piece);
    if (!found || !ACCOUNT.test(found.stripe_account) || !keyFits(found, this.env)) return SELLER;
    try {
      // Only the seller can tie an account to a store, so a store can't name someone else's account.
      if ((await boundStore(this.env, found.stripe_account)) !== target.origin) return SELLER;
      const paid = await chargeBid(this.env, { attempt, account: found.stripe_account, customer, paymentMethod: payment_method, cents: usd_cents, bid, question, ...target });
      if (paid.status === "requires_action") return refused("authentication_required", "Your bank wants to confirm this payment.");
      if (!["succeeded", "processing"].includes(paid.status)) return refused(paid.status, "Your card couldn't be charged.");
      return { ok: true, payment_intent: paid.id };
    } catch (error) {
      return outcome(error);
    }
  }
}
