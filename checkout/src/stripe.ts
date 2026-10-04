/** The two Stripe calls checkout needs, as raw form-encoded requests made as the seller's connected account. */

/** What Lore keeps from a sale, in cents. Stripe rejects a zero fee, so none is sent until this is raised. */
export const APPLICATION_FEE_CENTS = 0;

export class StripeError extends Error {
  constructor(readonly status: number) {
    super(`Stripe answered ${status}`);
  }
}

export type Sale = { account: string; origin: string; piece: string; name: string; cents: number };

export type Session = {
  id: string;
  url: string | null;
  payment_status: string;
  payment_intent: string | null;
  amount_total: number | null;
  metadata: Record<string, string>;
};

async function call(env: Env, account: string, path: string, body?: URLSearchParams): Promise<Session> {
  const response = await fetch(`${env.STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Account": account },
    body
  });
  if (!response.ok) throw new StripeError(response.status);
  return response.json();
}

export function createSession(env: Env, sale: Sale): Promise<Session> {
  const page = `${sale.origin}/p/${sale.piece}`;
  const fields: Record<string, string> = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(sale.cents),
    "line_items[0][price_data][product_data][name]": sale.name,
    "metadata[origin]": sale.origin,
    "metadata[piece]": sale.piece,
    "payment_intent_data[metadata][origin]": sale.origin,
    "payment_intent_data[metadata][piece]": sale.piece,
    success_url: `${page}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: page
  };
  if (APPLICATION_FEE_CENTS > 0) {
    fields["payment_intent_data[application_fee_amount]"] = String(APPLICATION_FEE_CENTS);
  }
  return call(env, sale.account, "/v1/checkout/sessions", new URLSearchParams(fields));
}

export function retrieveSession(env: Env, account: string, id: string): Promise<Session> {
  return call(env, account, `/v1/checkout/sessions/${id}`);
}

/** The v2 Accounts API is versioned per request; this is the version Lore's platform account was opened on. */
const V2_VERSION = "2026-08-26.dahlia";

async function v2<T>(env: Env, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${env.STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": V2_VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw new StripeError(response.status);
  return response.json();
}

/**
 * A seller's own Stripe account: the full Stripe Dashboard, Stripe's fees taken
 * from the seller, and Stripe (not Lore) covering losses. Neither can change later.
 */
export async function createAccount(env: Env): Promise<string> {
  const account = await v2<{ id: string }>(env, "/v2/core/accounts", {
    identity: { country: "us" },
    dashboard: "full",
    defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
    configuration: { merchant: { capabilities: { card_payments: { requested: true } } } }
  });
  return account.id;
}

/** Stripe's hosted form, where the seller gives Stripe their details and bank. */
export async function onboardingLink(env: Env, account: string, refresh: string, done: string): Promise<string> {
  const link = await v2<{ url: string }>(env, "/v2/core/account_links", {
    account,
    use_case: { type: "account_onboarding", account_onboarding: { configurations: ["merchant"], refresh_url: refresh, return_url: done } }
  });
  return link.url;
}

/** Whether Stripe lets this account take card payments yet. */
export async function cardPaymentsReady(env: Env, account: string): Promise<boolean> {
  const found = await v2<{ configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } } }>(
    env,
    `/v2/core/accounts/${account}?include=configuration.merchant`
  );
  return found.configuration?.merchant?.capabilities?.card_payments?.status === "active";
}
