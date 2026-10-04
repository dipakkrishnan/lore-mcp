import { vi } from "vitest";

/** Must match the `STRIPE_API` override in vitest.config.ts. */
export const STRIPE_API = "https://stripe.test";
export const STORE = "https://store.test";
export const PIECE = "c088ea0586199c3045feaceb";
export const ACCOUNT = "acct_1SellerAbc";

export type Listing = { id: string; teaser: string; price_usd: number; stripe_account: string; test: boolean };

export const listing = (overrides: Partial<Listing> = {}): Listing => ({
  id: PIECE,
  teaser: "What beat a cold deck",
  price_usd: 3,
  stripe_account: ACCOUNT,
  test: false,
  ...overrides
});

type Options = {
  store?: Listing | null;
  session?: Record<string, unknown>;
  stripeStatus?: number;
};

/**
 * Stubs the store's `/p/<id>.json` and the two Stripe endpoints. Restore with
 * `vi.restoreAllMocks()`. Any other outbound fetch throws.
 */
export function stub({ store = listing(), session = {}, stripeStatus = 200 }: Options = {}) {
  const stripe: { url: string; headers: Headers; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === STORE && url.pathname === `/p/${PIECE}.json`) {
      return store ? Response.json(store) : new Response("not found", { status: 404 });
    }
    if (url.origin === STRIPE_API && url.pathname.startsWith("/v1/checkout/sessions")) {
      stripe.push({ url: request.url, headers: request.headers, body: await request.text() });
      if (stripeStatus !== 200) return Response.json({ error: { message: "no" } }, { status: stripeStatus });
      return Response.json({
        id: "cs_test_abc",
        url: "https://checkout.stripe.test/c/pay/cs_test_abc",
        payment_status: "paid",
        payment_intent: "pi_123",
        amount_total: 300,
        metadata: { origin: STORE, piece: PIECE },
        ...session
      });
    }
    throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
  });
  return stripe;
}
