/** Stripe's events. Connect (XC-039): a card payment that finished on a seller's
 * account is passed to that seller's store, so the sale counts even when the
 * buyer never comes back to the page. The store checks the session with this
 * Worker's /verify before writing anything; the notice only names it.
 * Bids (MON-054): the platform's saved card opens a bid, and a bid's settled
 * direct charge fills it, both told to the bid book over the BidRail binding.
 * Which events are acted on, and what each names, is events.ts (XC-102). */
import { type Event, bidCharge, failureMessage, route } from "./events.js";
import { boundStore, retrieveSetup } from "./stripe.js";

/** How old a signed event may be; Stripe's own libraries default to five minutes. */
const TOLERANCE_SECONDS = 300;

/** yourlore.dev's bid book, as its BidRail entrypoint offers it. */
type Rail = {
  cardSaved(bid: string, card: { customer: string; payment_method: string }): Promise<boolean>;
  paid(bid: string, payment: { payment_intent: string; charge: string; amount_cents: number; currency: string; account: string }): Promise<"filled" | "pending" | "rejected">;
  failed(bid: string, failure: { payment_intent: string; account: string; message: string }): Promise<"declined" | "pending" | "rejected">;
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

/** A bid's direct charge settled: the bid book fills it if it is that bid's charge, and only then is the seller's store told. */
async function bidPaid(env: Env, event: Event): Promise<Response> {
  try {
    const found = bidCharge(event);
    if (!found?.intent.latest_charge) return reply(200, "not a Lore bid charge");
    const verdict = await rail(env).paid(found.bid, {
      payment_intent: found.id,
      charge: found.intent.latest_charge,
      amount_cents: found.intent.amount_received ?? 0,
      currency: found.intent.currency ?? "",
      account: found.account
    });
    // The charge's own reply hasn't reached the bid book yet; Stripe sends the event again.
    if (verdict === "pending") return reply(503, "bid book not ready");
    if (verdict !== "filled") return reply(200, "not this bid's charge");
    const notice = await fetch(`${found.origin}/p/${found.piece}/paid`, { method: "POST", body: new URLSearchParams({ session_id: found.id }) });
    // A retry fills nothing twice: the book answers "filled" again for the same charge, and the store
    // keeps a sale once. Only a store that couldn't answer gets it again; one that judged it (say, after
    // the seller rebound the account) has had its say, and the bid is filled either way.
    return notice.status >= 500 ? reply(502, "store refused") : reply(200, "bid filled");
  } catch {
    return reply(502, "unreachable");
  }
}

/** A bid's charge failed or was canceled after checkout sent it: a decline the buyer sees and can fix. */
async function bidFailed(env: Env, event: Event): Promise<Response> {
  try {
    const found = bidCharge(event);
    if (!found) return reply(200, "not a Lore bid charge");
    const verdict = await rail(env).failed(found.bid, { payment_intent: found.id, account: found.account, message: failureMessage(event) });
    if (verdict === "pending") return reply(503, "bid book not ready");
    return reply(200, verdict === "declined" ? "bid declined" : "not this bid's charge");
  } catch {
    return reply(502, "unreachable");
  }
}

/** A seller's card sale was paid: only the store the seller tied this account to hears about it. */
async function sale(env: Env, { account, origin, piece, session }: { account: string; origin: string; piece: string; session: string }): Promise<Response> {
  try {
    if ((await boundStore(env, account)) !== origin) return reply(200, "not this account's store");
    const notice = await fetch(`${origin}/p/${piece}/paid`, {
      method: "POST",
      body: new URLSearchParams({ session_id: session })
    });
    // A store that can't take it now gets it again: Stripe retries a failed delivery for days.
    return notice.ok ? reply(200, "recorded") : reply(502, "store refused");
  } catch {
    return reply(502, "store unreachable");
  }
}

export async function webhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const header = request.headers.get("stripe-signature") ?? "";
  const [connect, platform] = await Promise.all([signed(body, header, env.STRIPE_WEBHOOK_SECRET), signed(body, header, env.STRIPE_PLATFORM_WEBHOOK_SECRET)]);
  if (!connect && !platform) return reply(400, "unsigned");
  const event = JSON.parse(body) as Event;
  const where = route(event, platform);
  switch (where.to) {
    case "card saved":
      return cardSaved(env, where.bid, where.setupIntent);
    case "bid paid":
      return bidPaid(env, event);
    case "bid failed":
      return bidFailed(env, event);
    case "sale":
      return sale(env, where);
    case "drop":
      return reply(200, where.outcome);
  }
}
