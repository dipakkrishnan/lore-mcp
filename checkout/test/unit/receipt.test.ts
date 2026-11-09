// XC-102: /verify's `paid` rule and the rest of its answer, as a table. That /verify looks the
// session or charge up, and answers 400, 404-as-unpaid and 502, is test/checkout.test.ts.
import { describe, expect, it } from "vitest";
import { receipt } from "../../src/receipt";
import { PIECE, STORE } from "../stubs";

const session = (overrides: Partial<Parameters<typeof receipt>[0]> = {}) => ({
  payment_status: "paid",
  payment_intent: "pi_test_123",
  amount_total: 300,
  metadata: { origin: STORE, piece: PIECE },
  ...overrides
});

describe("receipt", () => {
  it.each<[string, ReturnType<typeof session>, string, boolean]>([
    ["paid, into an account tied to this store", session(), STORE, true],
    ["paid, into an account tied to another store", session(), "https://other.test", false],
    ["paid, into an account tied to no store", session(), "", false],
    ["paid, but the session names no store, into an account tied to none", session({ metadata: { piece: PIECE } }), "", false],
    ["paid, naming an empty store, into an account tied to none", session({ metadata: { origin: "", piece: PIECE } }), "", false],
    ["unpaid", session({ payment_status: "unpaid" }), STORE, false],
    ["no payment required", session({ payment_status: "no_payment_required" }), STORE, false]
  ])("%s → paid: %o", (_, found, bound, paid) => {
    expect(receipt(found, bound).paid).toBe(paid);
  });

  it("names the piece, store, charge and amount in dollars", () => {
    expect(receipt(session(), STORE)).toEqual({ paid: true, piece: PIECE, origin: STORE, payment_intent: "pi_test_123", amount_usd: 3 });
    expect(receipt(session({ amount_total: 1999 }), STORE).amount_usd).toBe(19.99);
  });

  it("answers empty values where Stripe left them out", () => {
    expect(receipt(session({ payment_intent: null, amount_total: null, metadata: {} }), "")).toEqual({
      paid: false,
      piece: "",
      origin: "",
      payment_intent: "",
      amount_usd: 0
    });
  });
});
