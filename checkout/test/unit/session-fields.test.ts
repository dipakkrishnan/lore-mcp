// XC-102: the form createSession sends Stripe for a card sale. That it is sent as the seller's
// account, to /v1/checkout/sessions, is test/checkout.test.ts.
import { describe, expect, it } from "vitest";
import { APPLICATION_FEE_CENTS, sessionFields } from "../../src/stripe";
import { PIECE, STORE } from "../stubs";

const sale = { origin: STORE, piece: PIECE, name: "What beat a cold deck", cents: 300 };

describe("sessionFields", () => {
  it("is one line item at the store's price, tagged with its store and piece, back to its page", () => {
    expect(sessionFields(sale)).toEqual({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "300",
      "line_items[0][price_data][product_data][name]": "What beat a cold deck",
      "metadata[origin]": STORE,
      "metadata[piece]": PIECE,
      "payment_intent_data[metadata][origin]": STORE,
      "payment_intent_data[metadata][piece]": PIECE,
      success_url: `${STORE}/p/${PIECE}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${STORE}/p/${PIECE}`
    });
  });

  it.each([
    ["no fee while Lore keeps none (Stripe rejects a zero fee)", 0, undefined],
    ["a fee once one is set", 25, "25"]
  ])("%s", (_, fee, expected) => {
    expect(sessionFields(sale, fee)["payment_intent_data[application_fee_amount]"]).toBe(expected);
  });

  it("sends no fee today", () => {
    expect(APPLICATION_FEE_CENTS).toBe(0);
    expect(sessionFields(sale)).not.toHaveProperty("payment_intent_data[application_fee_amount]");
  });

  it.each([
    ["a local store", "http://localhost:8787", "http://localhost:8787/p/" + PIECE],
    ["a store on its own port", "https://store.test:8443", "https://store.test:8443/p/" + PIECE]
  ])("returns the buyer to the piece's page on %s", (_, origin, page) => {
    const fields = sessionFields({ ...sale, origin });
    expect(fields.cancel_url).toBe(page);
    expect(fields.success_url).toBe(`${page}?session_id={CHECKOUT_SESSION_ID}`);
  });
});
