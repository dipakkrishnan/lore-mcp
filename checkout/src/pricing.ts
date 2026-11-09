/**
 * What a card sale charges, and whether a listing can be sold by card at all (XC-102). /create
 * asks these of what the store said; test/unit/pricing.test.ts runs them in plain node.
 */
import { ACCOUNT, CARD_MINIMUM_USD, type Listing } from "./store.js";

/** A listing takes cards when it names a Stripe account and asks at least the card minimum. */
export function takesCards(found: Pick<Listing, "stripe_account" | "price_usd">): boolean {
  // `>=` rather than `<`, so a price that isn't a number (NaN) is refused too.
  return ACCOUNT.test(found.stripe_account) && found.price_usd >= CARD_MINIMUM_USD;
}

/** A USD price as the whole cents Stripe charges, rounded to the nearest cent. */
export function cents(usd: number): number {
  return Math.round(usd * 100);
}
