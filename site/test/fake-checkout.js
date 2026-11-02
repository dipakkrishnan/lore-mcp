// Stands in for checkout's BidCards entrypoint in the site's tests. Nothing here reaches Stripe.
// A charge's outcome follows the saved payment method's id, like Stripe's test cards do.
import { WorkerEntrypoint } from "cloudflare:workers";

const asked = [];

export class BidCards extends WorkerEntrypoint {
  setup(request) {
    asked.push({ setup: request });
    if (request.question.includes("checkout is down")) return { url: null };
    return { url: `https://checkout.stripe.test/c/setup/${request.bid}` };
  }

  charge(request) {
    asked.push({ charge: request });
    if (request.payment_method === "pm_unreachable") return { ok: false, retry: true };
    if (request.payment_method === "pm_declined") return { ok: false, reason: "card_declined", message: "Your card was declined." };
    if (request.payment_method === "pm_authenticate") return { ok: false, reason: "authentication_required", message: "Your bank wants to confirm this payment." };
    return { ok: true, payment_intent: `pi_${request.attempt.replace(/-/g, "_")}` };
  }

  asked() {
    return asked;
  }

  forget() {
    asked.length = 0;
  }
}

export default { fetch: () => new Response("fake checkout") };
