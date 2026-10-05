/** Stripe's Connect events (XC-039): a card payment that finished on a seller's
 * account is passed to that seller's store, so the sale counts even when the
 * buyer never comes back to the page. The store checks the session with this
 * Worker's /verify before writing anything; the notice only names it. */
import { boundStore } from "./stripe.js";

/** How old a signed event may be; Stripe's own libraries default to five minutes. */
const TOLERANCE_SECONDS = 300;
const PAID_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const PIECE = /^[0-9a-f]{24}$/;

type Event = {
  type: string;
  account?: string;
  data: { object: { id?: string; payment_status?: string; metadata?: Record<string, string> } };
};

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

export async function webhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  if (!(await signed(body, request.headers.get("stripe-signature") ?? "", env.STRIPE_WEBHOOK_SECRET))) return reply(400, "unsigned");
  const event = JSON.parse(body) as Event;
  const session = event.data.object;
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
      body: new URLSearchParams({ session_id: session.id ?? "", account })
    });
    // A store that can't take it now gets it again: Stripe retries a failed delivery for days.
    return notice.ok ? reply(200, "recorded") : reply(502, "store refused");
  } catch {
    return reply(502, "store unreachable");
  }
}
