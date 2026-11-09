// XC-102: the card minimum and the cents a card sale charges, as tables. What /create answers for
// a listing that doesn't take cards is test/checkout.test.ts.
import { describe, expect, it } from "vitest";
import { cents, takesCards } from "../../src/pricing";
import { CARD_MINIMUM_USD } from "../../src/store";
import { ACCOUNT } from "../stubs";

describe("takesCards", () => {
  it("holds a card sale to Stripe's 50-cent minimum", () => {
    expect(CARD_MINIMUM_USD).toBe(0.5);
  });

  it.each<[string, string, number, boolean]>([
    ["a connected account at a normal price", ACCOUNT, 3, true],
    ["exactly the minimum", ACCOUNT, 0.5, true],
    ["a cent under the minimum", ACCOUNT, 0.49, false],
    ["free", ACCOUNT, 0, false],
    ["a negative price", ACCOUNT, -3, false],
    ["a price that isn't a number", ACCOUNT, Number.NaN, false],
    ["no account", "", 3, false],
    ["an account id that isn't one", "acct_", 3, false],
    ["an account with a stray character", "acct_1Seller-Abc", 3, false],
    ["someone's customer id", "cus_1Buyer", 3, false]
  ])("%s → %o", (_, stripe_account, price_usd, expected) => {
    expect(takesCards({ stripe_account, price_usd })).toBe(expected);
  });
});

describe("cents", () => {
  it.each([
    [3, 300],
    [0.5, 50],
    [19.99, 1999],
    // 1.005 * 100 is 100.49999999999999 in floating point: rounded, not truncated or carried.
    [1.005, 100],
    [0.295, 30],
    [4.35, 435],
    [0.014, 1],
    [0.015, 2],
    [1000, 100000]
  ])("$%d → %d cents", (usd, expected) => {
    expect(cents(usd)).toBe(expected);
  });
});
