import { StripeError, createSession, retrieveSession } from "./stripe.js";

/** Cards can't charge less; a store priced below this offers no card checkout. */
export const CARD_MINIMUM_USD = 0.5;

const PIECE = /^[0-9a-f]{24}$/;
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const SESSION = /^cs_[A-Za-z0-9_]+$/;

/** What a store says about one piece at /p/<id>.json; only fields its pages already show for free. */
type Listing = { id: string; teaser: string; price_usd: number; stripe_account: string; test: boolean };

const text = (status: number, message: string) =>
  new Response(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** A store origin exactly as a store page posts it; plain http only for a store running on this machine. */
function storeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return (url.protocol === "https:" || local) && url.origin === value ? url.origin : null;
  } catch {
    return null;
  }
}

async function listing(origin: string, piece: string): Promise<Listing | null> {
  try {
    const response = await fetch(`${origin}/p/${piece}.json`);
    if (!response.ok) return null;
    const found: Listing = await response.json();
    return found.id === piece ? found : null;
  } catch {
    return null;
  }
}

async function create(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value : "";
  };
  const origin = storeOrigin(field("origin"));
  const piece = field("id");
  if (!origin || !PIECE.test(piece)) return text(400, "That isn't a Lore piece.");
  // Price, payee and name all come from the store itself, never the buyer's form.
  const found = await listing(origin, piece);
  if (!found) return text(404, "This piece isn't for sale.");
  if (!ACCOUNT.test(found.stripe_account) || !(found.price_usd >= CARD_MINIMUM_USD)) {
    return text(409, "This store doesn't take cards.");
  }
  if (found.test && !env.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    return text(409, "This is a test store, so it can't take a real card payment.");
  }
  try {
    const session = await createSession(env, {
      account: found.stripe_account,
      origin,
      piece,
      name: found.teaser.slice(0, 250),
      cents: Math.round(found.price_usd * 100)
    });
    if (!session.url) throw new StripeError(502);
    return Response.redirect(session.url, 303);
  } catch {
    return text(502, "Card checkout is unavailable right now. Try again in a minute.");
  }
}

async function verify(url: URL, env: Env): Promise<Response> {
  const session = url.searchParams.get("session") ?? "";
  const account = url.searchParams.get("account") ?? "";
  if (!SESSION.test(session) || !ACCOUNT.test(account)) return json({ error: "a session and an account are required" }, 400);
  try {
    const found = await retrieveSession(env, account, session);
    return json({
      paid: found.payment_status === "paid",
      piece: found.metadata.piece ?? "",
      origin: found.metadata.origin ?? "",
      payment_intent: found.payment_intent ?? "",
      amount_usd: (found.amount_total ?? 0) / 100
    });
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return json({ paid: false });
    return json({ error: "Stripe is unreachable" }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") return create(request, env);
    if (url.pathname === "/verify" && request.method === "GET") return verify(url, env);
    if (url.pathname === "/") return text(200, "Lore card checkout. Payments go straight to each seller's own Stripe account.");
    return text(404, "Not found.");
  }
};
