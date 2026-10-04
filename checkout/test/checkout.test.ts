import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as entry from "../src/index";
import { ACCOUNT, PIECE, STORE, listing, stub } from "./stubs";

afterEach(() => {
  vi.restoreAllMocks();
});

const buy = (fields: Record<string, string> = { origin: STORE, id: PIECE }) =>
  exports.default.fetch("https://checkout.test/create", { method: "POST", body: new URLSearchParams(fields), redirect: "manual" });

const verify = (query: string) => exports.default.fetch(`https://checkout.test/verify?${query}`);

describe("create", () => {
  it("opens a direct charge on the seller's account at the store's own price, and sends the buyer to Stripe", async () => {
    const calls = stub();
    const response = await buy();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://checkout.stripe.test/c/pay/cs_test_abc");
    const [call] = calls;
    expect(call.headers.get("stripe-account")).toBe(ACCOUNT);
    expect(call.headers.get("authorization")).toBe("Bearer sk_test_not_a_real_key");
    const sent = new URLSearchParams(call.body);
    expect(sent.get("mode")).toBe("payment");
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("300");
    expect(sent.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(sent.get("line_items[0][price_data][product_data][name]")).toBe("What beat a cold deck");
    expect(sent.get("metadata[piece]")).toBe(PIECE);
    expect(sent.get("metadata[origin]")).toBe(STORE);
    expect(sent.get("success_url")).toBe(`${STORE}/p/${PIECE}?session_id={CHECKOUT_SESSION_ID}`);
    expect(sent.get("cancel_url")).toBe(`${STORE}/p/${PIECE}`);
    // Lore takes nothing yet, and Stripe refuses a zero fee, so none is sent.
    expect(sent.has("payment_intent_data[application_fee_amount]")).toBe(false);
  });

  it("takes price and payee from the store, ignoring anything the buyer adds to the form", async () => {
    const calls = stub();
    await buy({ origin: STORE, id: PIECE, price_usd: "0.01", stripe_account: "acct_Attacker", unit_amount: "1" });
    const sent = new URLSearchParams(calls[0].body);
    expect(calls[0].headers.get("stripe-account")).toBe(ACCOUNT);
    expect(sent.get("line_items[0][price_data][unit_amount]")).toBe("300");
  });

  it("refuses stores that don't take cards", async () => {
    for (const store of [listing({ stripe_account: "" }), listing({ price_usd: 0.49 }), listing({ id: "f".repeat(24) })]) {
      const calls = stub({ store });
      expect((await buy()).status).toBeGreaterThanOrEqual(400);
      expect(calls).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it("refuses a malformed origin or piece without calling anyone", async () => {
    const calls = stub();
    const malformed: Record<string, string>[] = [
      { origin: "http://store.test", id: PIECE },
      { origin: `${STORE}/evil`, id: PIECE },
      { origin: STORE, id: "../admin" },
      {}
    ];
    for (const fields of malformed) {
      expect((await buy(fields)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("says plainly when Stripe is down", async () => {
    stub({ stripeStatus: 500 });
    const response = await buy();
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("unavailable right now");
  });
});

describe("verify", () => {
  it("reports a paid session with what it paid for, asking Stripe as the seller's account", async () => {
    const calls = stub();
    const response = await verify(`session=cs_test_abc&account=${ACCOUNT}`);
    expect(await response.json()).toEqual({ paid: true, piece: PIECE, origin: STORE, payment_intent: "pi_123", amount_usd: 3 });
    expect(new URL(calls[0].url).pathname).toBe("/v1/checkout/sessions/cs_test_abc");
    expect(calls[0].headers.get("stripe-account")).toBe(ACCOUNT);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports unpaid and unknown sessions as unpaid", async () => {
    stub({ session: { payment_status: "unpaid" } });
    expect(await (await verify(`session=cs_test_abc&account=${ACCOUNT}`)).json()).toMatchObject({ paid: false });
    vi.restoreAllMocks();
    stub({ stripeStatus: 404 });
    expect(await (await verify(`session=cs_test_abc&account=${ACCOUNT}`)).json()).toEqual({ paid: false });
  });

  it("rejects malformed input before asking Stripe", async () => {
    const calls = stub();
    expect((await verify("session=nope&account=acct_1")).status).toBe(400);
    expect((await verify(`session=cs_test_abc&account=x/../y`)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

it("exports only the handler, since the Workers runtime refuses any other export", () => {
  expect(Object.keys(entry)).toEqual(["default"]);
});

describe("seller accounts", () => {
  const open = async () => (await (await exports.default.fetch("https://checkout.test/accounts", { method: "POST" })).json()) as { account: string; token: string };

  it("opens a seller's own account: full dashboard, Stripe's fees and losses on Stripe, never Lore", async () => {
    const calls = stub();
    const { account, token } = await open();
    expect(account).toBe("acct_1NewSeller");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0].headers.get("stripe-version")).toMatch(/^\d{4}-\d{2}-\d{2}\./);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      dashboard: "full",
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } }
    });
  });

  it("sends the seller to Stripe's form only with their token, and an expired form comes back for a fresh one", async () => {
    stub();
    const { account, token } = await open();
    const calls = stub();
    const mine = await exports.default.fetch(`https://checkout.test/onboard?account=${account}&token=${token}`, { redirect: "manual" });
    expect(mine.status).toBe(303);
    expect(mine.headers.get("location")).toBe("https://connect.stripe.test/setup/s/abc");
    const link = JSON.parse(calls[0].body);
    expect(link.use_case.account_onboarding.refresh_url).toBe(`https://checkout.test/onboard?account=${account}&token=${token}`);
    expect(link.use_case.account_onboarding.return_url).toBe("https://checkout.test/onboarded");
    const forged = await exports.default.fetch(`https://checkout.test/onboard?account=acct_1SomeoneElse&token=${token}`, { redirect: "manual" });
    expect(forged.status).toBe(403);
  });

  it("says when Stripe lets the account take cards", async () => {
    stub();
    const { account, token } = await open();
    stub({ cardPayments: "restricted" });
    expect(await (await exports.default.fetch(`https://checkout.test/accounts/status?account=${account}&token=${token}`)).json()).toEqual({ ready: false });
    stub({ cardPayments: "active" });
    expect(await (await exports.default.fetch(`https://checkout.test/accounts/status?account=${account}&token=${token}`)).json()).toEqual({ ready: true });
    expect((await exports.default.fetch(`https://checkout.test/accounts/status?account=${account}&token=${"0".repeat(64)}`)).status).toBe(403);
  });
});
