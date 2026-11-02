/** The Stripe calls checkout needs, as raw form-encoded requests: a sale's are made as the seller's
 * connected account, and saving a bidder's card is made on Lore's platform account. */

/** What Lore keeps from a sale, in cents. Stripe rejects a zero fee, so none is sent until this is raised. */
export const APPLICATION_FEE_CENTS = 0;

export class StripeError extends Error {
  constructor(readonly status: number, reason = "", readonly code = "") {
    super(`Stripe answered ${status}${reason ? `: ${reason}` : ""}`);
  }
}

/** Stripe's own reason for refusing, kept in the Worker's logs so a 502 to the app can be explained. */
async function refused(response: Response, path: string): Promise<StripeError> {
  type Body = { error?: { code?: string; decline_code?: string; message?: string } };
  const body = await response.json<Body>().catch((): Body => ({ error: undefined }));
  const error = new StripeError(response.status, [body.error?.code, body.error?.message].filter(Boolean).join(" — "), body.error?.code ?? "");
  console.error(`${path}: ${error.message}`);
  return error;
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

/** One v1 call, as `account` or, when it is null, as Lore's platform; a key makes a retried POST one request. */
async function call<T = Session>(env: Env, account: string | null, path: string, body?: URLSearchParams, idempotency?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (account) headers["Stripe-Account"] = account;
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  const response = await fetch(`${env.STRIPE_API}${path}`, { method: body ? "POST" : "GET", headers, body });
  if (!response.ok) throw await refused(response, path);
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

export type Intent = { id: string; status: string; amount_received: number; latest_charge: string | null; metadata: Record<string, string> };

/** A bid's direct charge, read like a Checkout Session so /verify answers the same for both. */
export async function retrieveIntent(env: Env, account: string, id: string): Promise<Session> {
  const found = await call<Intent>(env, account, `/v1/payment_intents/${id}`);
  return { id, url: null, payment_status: found.status === "succeeded" ? "paid" : "unpaid", payment_intent: found.id, amount_total: found.amount_received, metadata: found.metadata };
}

/** A bid's buyer, on Lore's platform: Stripe keeps their card here until an answer is accepted. */
export async function createCustomer(env: Env, bid: string): Promise<string> {
  return (await call<{ id: string }>(env, null, "/v1/customers", new URLSearchParams({ "metadata[lore_bid]": bid }), `bid-${bid}-customer`)).id;
}

/** Stripe's page for saving a card, charged later and off session; nothing is charged here. */
export function createSetupSession(env: Env, setup: { bid: string; customer: string; question: string; returnUrl: string }): Promise<Session> {
  return call(
    env,
    null,
    "/v1/checkout/sessions",
    new URLSearchParams({
      mode: "setup",
      currency: "usd",
      customer: setup.customer,
      "metadata[lore_bid]": setup.bid,
      "setup_intent_data[metadata][lore_bid]": setup.bid,
      "setup_intent_data[description]": setup.question.slice(0, 250),
      success_url: setup.returnUrl,
      cancel_url: setup.returnUrl
    })
  );
}

export type SavedCard = { status: string; customer: string | null; payment_method: string | null; metadata: Record<string, string> };

export function retrieveSetup(env: Env, id: string): Promise<SavedCard> {
  return call<SavedCard>(env, null, `/v1/setup_intents/${id}`);
}

export type BidCharge = { attempt: string; account: string; customer: string; paymentMethod: string; cents: number; bid: string; origin: string; piece: string; question: string };

/**
 * The accepted answer's payment, as a direct charge on the seller's account: the platform's saved
 * card is cloned onto that account and charged there, off session, so the money never touches
 * Lore. Both requests carry keys built from the attempt, so a retried alarm charges once.
 */
export async function chargeBid(env: Env, charge: BidCharge): Promise<Intent> {
  const cloned = await call<{ id: string }>(
    env,
    charge.account,
    "/v1/payment_methods",
    new URLSearchParams({ customer: charge.customer, payment_method: charge.paymentMethod }),
    `${charge.attempt}-card`
  );
  const fields: Record<string, string> = {
    amount: String(charge.cents),
    currency: "usd",
    payment_method: cloned.id,
    confirm: "true",
    off_session: "true",
    "automatic_payment_methods[enabled]": "true",
    "automatic_payment_methods[allow_redirects]": "never",
    description: charge.question.slice(0, 250),
    "metadata[lore_bid]": charge.bid,
    "metadata[origin]": charge.origin,
    "metadata[piece]": charge.piece
  };
  if (APPLICATION_FEE_CENTS > 0) fields.application_fee_amount = String(APPLICATION_FEE_CENTS);
  return call<Intent>(env, charge.account, "/v1/payment_intents", new URLSearchParams(fields), charge.attempt);
}

/** The v2 Accounts API is versioned per request; this is the version Lore's platform account was opened on. */
const V2_VERSION = "2026-08-26.dahlia";

async function v2<T>(env: Env, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${env.STRIPE_API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Stripe-Version": V2_VERSION, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) throw await refused(response, path);
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

type Account = {
  metadata?: Record<string, string>;
  configuration?: { merchant?: { capabilities?: { card_payments?: { status?: string } } } };
  requirements?: { entries?: { awaiting_action_from?: string; minimum_deadline?: { status?: string } }[] };
};

const lookup = (env: Env, account: string) =>
  v2<Account>(env, `/v2/core/accounts/${account}?include=configuration.merchant&include=requirements`);

/** Whether Stripe lets this account take cards yet, and if not, whether Stripe is still checking or the seller owes it something. */
export async function cardPayments(env: Env, account: string): Promise<{ ready: boolean; checking: boolean }> {
  const found = await lookup(env, account);
  const ready = found.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  // Only what is due now decides it; items due later don't hold cards back.
  const due = (found.requirements?.entries ?? []).filter((entry) => ["currently_due", "past_due"].includes(entry.minimum_deadline?.status ?? ""));
  return { ready, checking: !ready && due.length > 0 && due.every((entry) => entry.awaiting_action_from === "stripe") };
}

/** The one store this account sells through, kept on the account where no store can write it. */
export async function boundStore(env: Env, account: string): Promise<string> {
  return (await lookup(env, account)).metadata?.lore_store ?? "";
}

/** Whether the key works: a read every checkout key can make, with nothing sent back to the caller. */
export async function reachable(env: Env): Promise<boolean> {
  try {
    await v2(env, "/v2/core/accounts?limit=1");
    return true;
  } catch {
    return false;
  }
}

export async function bindStore(env: Env, account: string, origin: string): Promise<void> {
  await v2(env, `/v2/core/accounts/${account}`, { metadata: { lore_store: origin } });
}
