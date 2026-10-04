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
