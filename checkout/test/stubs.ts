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
  cardPayments?: string;
  boundTo?: string;
  /** How the store answers checkout's paid notice. */
  noticeStatus?: number;
  awaiting?: string[];
};

/**
 * Stubs the store's `/p/<id>.json` and the two Stripe endpoints. Restore with
 * `vi.restoreAllMocks()`. Any other outbound fetch throws.
 */
export function stub({ store = listing(), session = {}, stripeStatus = 200, cardPayments = "active", boundTo = STORE, noticeStatus = 200, awaiting = [] }: Options = {}) {
  const stripe: { url: string; headers: Headers; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === STORE && url.pathname === `/p/${PIECE}.json`) {
      return store ? Response.json(store) : new Response("not found", { status: 404 });
    }
    if (url.origin === STORE && url.pathname === `/p/${PIECE}/paid` && request.method === "POST") {
      stripe.push({ url: request.url, headers: request.headers, body: await request.text() });
      return Response.json({ recorded: noticeStatus === 200 }, { status: noticeStatus });
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
    if (url.origin === STRIPE_API && url.pathname.startsWith("/v2/core/")) {
      stripe.push({ url: request.url, headers: request.headers, body: await request.text() });
      if (stripeStatus !== 200) return Response.json({ error: { message: "no" } }, { status: stripeStatus });
      if (url.pathname === "/v2/core/accounts") return Response.json({ id: "acct_1NewSeller" });
      if (url.pathname === "/v2/core/account_links") return Response.json({ url: "https://connect.stripe.test/setup/s/abc" });
      if (request.method === "POST") return Response.json({ id: url.pathname.split("/").pop(), metadata: (JSON.parse(stripe.at(-1)!.body) as { metadata: Record<string, string> }).metadata });
      return Response.json({ id: url.pathname.split("/").pop(), metadata: { lore_store: boundTo }, configuration: { merchant: { capabilities: { card_payments: { status: cardPayments } } } }, requirements: { entries: awaiting.map((who) => ({ awaiting_action_from: who })) } });
    }
    throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
  });
  return stripe;
}
