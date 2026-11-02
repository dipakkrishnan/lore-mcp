/** Stripe's events. Connect (XC-039): a card payment that finished on a seller's
 * account is passed to that seller's store, so the sale counts even when the
 * buyer never comes back to the page. The store checks the session with this
 * Worker's /verify before writing anything; the notice only names it.
 * Bids (MON-054): the platform's saved card opens a bid, and a bid's settled
 * direct charge fills it, both told to the bid book over the BidRail binding. */
import { boundStore, retrieveSetup } from "./stripe.js";

/** How old a signed event may be; Stripe's own libraries default to five minutes. */
const TOLERANCE_SECONDS = 300;
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const PIECE = /^[0-9a-f]{24}$/;
const BID = /^[a-z0-9]{10}$/;

type Event = {
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
      metadata?: Record<string, string>;
    };
  };
};

/** yourlore.dev's bid book, as its BidRail entrypoint offers it. */
type Rail = {
  cardSaved(bid: string, card: { customer: string; payment_method: string }): Promise<boolean>;
  paid(bid: string, payment: { payment_intent: string; charge: string; amount_cents: number }): Promise<boolean>;
};
const rail = (env: Env) => env.BIDS_RAIL as unknown as Rail;

const bytes = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)));

/** Stripe-Signature is `t=<seconds>,v1=<hex>[,v1=<hex>…]` over `<t>.<raw body>`; WebCrypto's verify compares in constant time. */
export async function signed(body: string, header: string, secret: string, now = Date.now() / 1000): Promise<boolean> {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key, value]) => key === "v1" && /^[0-9a-f]{64}$/.test(value ?? "")).map(([, value]) => value);
  if (!secret || !Number.isFinite(timestamp) || Math.abs(now - timestamp) > TOLERANCE_SECONDS || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const payload = new TextEncoder().encode(`${timestamp}.${body}`);
  for (const signature of signatures) {
    if (await crypto.subtle.verify("HMAC", key, bytes(signature), payload)) return true;
  }
  return false;
}

const reply = (status: number, outcome: string) =>
  new Response(JSON.stringify({ outcome }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** A bid buyer's card, saved on the platform by a setup-mode Checkout Session, opens their bid. */
async function cardSaved(env: Env, bid: string, setupIntent: string): Promise<Response> {
  try {
    const setup = await retrieveSetup(env, setupIntent);
    if (setup.status !== "succeeded" || !setup.customer || !setup.payment_method || setup.metadata.lore_bid !== bid) return reply(200, "no card saved");
    await rail(env).cardSaved(bid, { customer: setup.customer, payment_method: setup.payment_method });
    return reply(200, "card saved");
  } catch {
    return reply(502, "bid book unreachable");
  }
}

/** A bid's direct charge settled on the seller's account: the bid is filled, and the seller's store counts the sale. */
async function bidPaid(env: Env, event: Event): Promise<Response> {
  const intent = event.data.object;
  const account = event.account ?? "";
  const { lore_bid: bid = "", origin = "", piece = "" } = intent.metadata ?? {};
  if (!ACCOUNT.test(account) || !BID.test(bid) || !PIECE.test(piece) || !intent.id || !intent.latest_charge) return reply(200, "not a Lore bid");
  try {
    if ((await boundStore(env, account)) !== origin) return reply(200, "not this account's store");
    await rail(env).paid(bid, { payment_intent: intent.id, charge: intent.latest_charge, amount_cents: intent.amount_received ?? 0 });
    const notice = await fetch(`${origin}/p/${piece}/paid`, { method: "POST", body: new URLSearchParams({ session_id: intent.id }) });
    // The bid book ignores a fill it already has, so Stripe's retry only re-sends the store's notice.
    return notice.ok ? reply(200, "bid filled") : reply(502, "store refused");
  } catch {
    return reply(502, "unreachable");
  }
}

/** The Connect endpoint and the platform endpoint each sign with their own secret. */
async function signedByStripe(body: string, header: string, env: Env): Promise<boolean> {
  for (const secret of [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_PLATFORM_WEBHOOK_SECRET]) {
    if (await signed(body, header, secret)) return true;
  }
  return false;
}

export async function webhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!(await signedByStripe(body, request.headers.get("stripe-signature") ?? "", env))) return reply(400, "unsigned");
  const event = JSON.parse(body) as Event;
  const session = event.data.object;
  const bid = session.metadata?.lore_bid ?? "";
  if (event.type === "checkout.session.completed" && session.mode === "setup") {
    return !event.account && BID.test(bid) && session.setup_intent ? cardSaved(env, bid, session.setup_intent) : reply(200, "not a Lore bid");
  }
  if (event.type === "payment_intent.succeeded") return bid ? bidPaid(env, event) : reply(200, "ignored");
  // Anything else Stripe sends is acknowledged and dropped; a 2xx stops it retrying.
  if (!PAID_EVENTS.has(event.type) || session.payment_status !== "paid") return reply(200, "ignored");
  const account = event.account ?? "";
  const origin = session.metadata?.origin ?? "";
  const piece = session.metadata?.piece ?? "";
  if (!ACCOUNT.test(account) || !SESSION.test(session.id ?? "") || !PIECE.test(piece)) return reply(200, "not a Lore sale");
  try {
    // Only the store the seller tied this account to hears about its sales.
    if ((await boundStore(env, account)) !== origin) return reply(200, "not this account's store");
    const notice = await fetch(`${origin}/p/${piece}/paid`, {
      method: "POST",
      body: new URLSearchParams({ session_id: session.id ?? "" })
    });
    // A store that can't take it now gets it again: Stripe retries a failed delivery for days.
    return notice.ok ? reply(200, "recorded") : reply(502, "store refused");
  } catch {
    return reply(502, "store unreachable");
  }
}
