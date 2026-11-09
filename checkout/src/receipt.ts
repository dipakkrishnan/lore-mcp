/**
 * What /verify answers for a session or a bid's charge Stripe found (XC-102), apart from the
 * lookups so test/unit/receipt.test.ts can run it in plain node.
 */
import type { Session } from "./stripe.js";

export type Receipt = { paid: boolean; piece: string; origin: string; payment_intent: string; amount_usd: number };

/**
 * `bound` is the store the paying account's seller tied it to. Paid means paid into an account its
 * seller tied to this very store: anyone can open an account and pay themselves, but only the seller
 * can tie it to their store.
 */
export function receipt(found: Pick<Session, "payment_status" | "payment_intent" | "amount_total" | "metadata">, bound: string): Receipt {
  const origin = found.metadata.origin ?? "";
  return {
    paid: found.payment_status === "paid" && origin !== "" && bound === origin,
    piece: found.metadata.piece ?? "",
    origin,
    payment_intent: found.payment_intent ?? "",
    amount_usd: (found.amount_total ?? 0) / 100
  };
}
