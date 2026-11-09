import { cents, takesCards } from "./pricing.js";
import { receipt } from "./receipt.js";
import { ACCOUNT, PIECE, keyFits, listing, storeOrigin } from "./store.js";
import { StripeError, bindStore, boundStore, cardPayments, createAccount, createSession, onboardingLink, reachable, retrieveIntent, retrieveSession } from "./stripe.js";
import { owns, token } from "./token.js";
import { webhook } from "./webhooks.js";

export { BidCards } from "./bids.js";

/** A Checkout Session, or a bid's direct charge (MON-054); either one opens the piece it paid for. */
const SESSION = /^(cs|pi)_[A-Za-z0-9_]+$/;

const text = (status: number, message: string) =>
  new Response(`${message}\n`, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

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
  if (!takesCards(found)) {
    return text(409, "This store doesn't take cards.");
  }
  if (!keyFits(found, env)) {
    return text(409, "This is a test store, so it can't take a real card payment.");
  }
  try {
    // A store names its payee, but only the seller can say which store an account sells through.
    if ((await boundStore(env, found.stripe_account)) !== origin) return text(409, "This store isn't connected to that Stripe account.");
    const session = await createSession(env, {
      account: found.stripe_account,
      origin,
      piece,
      name: found.teaser.slice(0, 250),
      cents: cents(found.price_usd)
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
    const lookup = session.startsWith("pi_") ? retrieveIntent(env, account, session) : retrieveSession(env, account, session);
    const [found, bound] = await Promise.all([lookup, boundStore(env, account)]);
    return json(receipt(found, bound));
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) return json({ paid: false });
    return json({ error: "Stripe is unreachable" }, 502);
  }
}

async function openAccount(env: Env): Promise<Response> {
  try {
    const account = await createAccount(env);
    // The seller's proof of the account (token.ts); every later call about it must carry this.
    return json({ account, token: await token(env.ACCOUNT_TOKEN_SECRET, account) });
  } catch {
    return json({ error: "Stripe is unreachable" }, 502);
  }
}

async function onboard(url: URL, env: Env): Promise<Response> {
  const account = url.searchParams.get("account") ?? "";
  if (!(await owns(env.ACCOUNT_TOKEN_SECRET, account, url.searchParams.get("token") ?? ""))) return text(403, "This link isn't yours to open.");
  try {
    // An expired form sends the seller back here, which makes a fresh one.
    return Response.redirect(await onboardingLink(env, account, url.href, `${url.origin}/onboarded`), 303);
  } catch {
    return text(502, "Stripe is unavailable right now. Try again in a minute.");
  }
}

/** The seller ties their account to their store; checkout then refuses any other store naming it. */
async function bind(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const value = form?.get(name);
    return typeof value === "string" ? value : "";
  };
  const account = field("account");
  const origin = storeOrigin(field("origin"));
  if (!(await owns(env.ACCOUNT_TOKEN_SECRET, account, field("token")))) return json({ error: "not your account" }, 403);
  if (!origin) return json({ error: "a store address is required" }, 400);
  try {
    await bindStore(env, account, origin);
    return json({ account, origin });
  } catch {
    return json({ error: "Stripe is unreachable" }, 502);
  }
}

async function accountStatus(url: URL, env: Env): Promise<Response> {
  const account = url.searchParams.get("account") ?? "";
  if (!(await owns(env.ACCOUNT_TOKEN_SECRET, account, url.searchParams.get("token") ?? ""))) return json({ error: "not your account" }, 403);
  try {
    return json(await cardPayments(env, account));
  } catch {
    return json({ error: "Stripe is unreachable" }, 502);
  }
}

/** After a key swap: does Stripe take this key? Says only yes or no. */
async function health(env: Env): Promise<Response> {
  return (await reachable(env)) ? json({ ok: true }) : json({ ok: false }, 502);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/create" && request.method === "POST") return create(request, env);
    if (url.pathname === "/verify" && request.method === "GET") return verify(url, env);
    if (url.pathname === "/accounts" && request.method === "POST") return openAccount(env);
    if (url.pathname === "/accounts/status" && request.method === "GET") return accountStatus(url, env);
    if (url.pathname === "/accounts/bind" && request.method === "POST") return bind(request, env);
    if (url.pathname === "/onboard" && request.method === "GET") return onboard(url, env);
    if (url.pathname === "/webhooks" && request.method === "POST") return webhook(request, env);
    if (url.pathname === "/health" && request.method === "GET") return health(env);
    if (url.pathname === "/onboarded") return text(200, "You're set up with Stripe. Go back to Lore; it finishes the rest.");
    if (url.pathname === "/") return text(200, "Lore card checkout. Payments go straight to each seller's own Stripe account.");
    return text(404, "Not found.");
  }
};
