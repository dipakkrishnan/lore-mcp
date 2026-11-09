// XC-100: what the storefront sells, at what price, by which means, and whether a card receipt paid for it.
// The pages and checkout round trips built on these are covered through the Worker by card.test.ts.
import { describe, expect, it } from "vitest";
import type { Catalog } from "../../src/answer-state.js";
import type { Collection } from "../../src/collections.js";
import { MAINNET, type NetworkEnv } from "../../src/network.js";
import { PRICE_USD } from "../../src/price.js";
import {
  CARD_MINIMUM_USD,
  type Receipt,
  findItem,
  paidBy,
  priceOf,
  storeFor,
  takesCards,
  verifiable
} from "../../src/pricing.js";
import { type AnswerSettings, parseSettings } from "../../src/settings.js";

const settings = (overrides: Partial<AnswerSettings> = {}): AnswerSettings => ({ ...parseSettings([]), ...overrides });
const env = (overrides: Partial<NetworkEnv> = {}) =>
  ({ LORE_WALLET: "0x000000000000000000000000000000000000dEaD", CHECKOUT_URL: "https://checkout.test", ...overrides }) as NetworkEnv;
const ACCOUNT = "acct_1Abc";
const ORIGIN = "https://lore.example.workers.dev";

describe("priceOf", () => {
  it.each([
    [0, PRICE_USD],
    [0.25, 0.25],
    [3, 3]
  ])("a pushed price of %d sells a piece at %d", (pushed, price) => {
    expect(priceOf(settings({ publicationPriceUsd: pushed }))).toBe(price);
  });
});

describe("takesCards", () => {
  it.each([
    [ACCOUNT, CARD_MINIMUM_USD, true],
    [ACCOUNT, 5, true],
    // Cards can't charge less than the minimum.
    [ACCOUNT, 0.49, false],
    [ACCOUNT, PRICE_USD, false],
    // No connected account, or something that isn't one.
    ["", 5, false],
    ["acct_", 5, false],
    ["acct_has space", 5, false],
    ["cus_1Abc", 5, false]
  ])("account %j at $%d takes cards: %s", (stripeAccount, price, takes) => {
    expect(takesCards(settings({ stripeAccount }), price)).toBe(takes);
  });
});

describe("storeFor", () => {
  it("describes a test-network store that agents pay, priced as pushed", () => {
    expect(storeFor(env(), ORIGIN, settings({ listedName: "Dipak", publicationPriceUsd: 0.2, freeCopies: 2, supportEmail: "a@b.c" }))).toEqual({
      name: "Dipak",
      priceUsd: 0.2,
      origin: ORIGIN,
      test: true,
      freeCopies: 2,
      support: "a@b.c",
      selling: true,
      agentsPay: true
    });
  });

  it.each([
    ["sells by card at or above the minimum", { stripeAccount: ACCOUNT }, 1, "https://checkout.test"],
    ["offers no checkout below the minimum", { stripeAccount: ACCOUNT }, 0.1, undefined],
    ["offers no checkout without an account", {}, 1, undefined],
    ["offers no checkout while online only for its owner's agents", { stripeAccount: ACCOUNT, selling: false }, 1, undefined]
  ])("%s", (_, overrides: Partial<AnswerSettings>, price, checkout) => {
    expect(storeFor(env(), ORIGIN, settings(overrides), price).checkout).toBe(checkout);
  });

  it("prices an item at its own price when given one, else the piece price", () => {
    expect(storeFor(env(), ORIGIN, settings({ publicationPriceUsd: 0.3 })).priceUsd).toBe(0.3);
    expect(storeFor(env(), ORIGIN, settings({ publicationPriceUsd: 0.3 }), 4).priceUsd).toBe(4);
  });

  it("says mainnet is real, and that a store without a wallet takes no agent payments", () => {
    const store = storeFor(env({ LORE_NETWORK: MAINNET, LORE_WALLET: "" }), ORIGIN, settings());
    expect(store).toMatchObject({ test: false, agentsPay: false });
  });
});

describe("findItem", () => {
  const A = "a".repeat(24);
  const B = "b".repeat(24);
  const C = "c".repeat(24);
  const catalog: Catalog = {
    manifest_version: 1,
    publication_count: 2,
    topics: {
      hiring: [{ id: A, teaser: "Hire managers early", kind: "claim", updated_at: "2026-08-01" }],
      pricing: [{ id: B, teaser: "A floor protects", kind: "content", updated_at: "2026-08-02" }]
    }
  };
  const set: Collection = { id: C, title: "Both", price_usd: 1, pieces: [B, "f".repeat(24), A] };

  it("finds a piece with its topic and section", () => {
    expect(findItem(catalog, [set], B)).toEqual({ piece: { ...catalog.topics.pricing[0], topic: "pricing", section: 1 } });
  });

  it("finds a collection with the pieces of it still listed, in the collection's order", () => {
    const found = findItem(catalog, [set], C);
    expect(found && "set" in found && found.set).toBe(set);
    expect(found && "set" in found && found.entries.map((entry) => entry.id)).toEqual([B, A]);
  });

  it.each([
    ["an id in neither", "d".repeat(24), [set]],
    ["a collection that isn't sold", C, []]
  ])("finds nothing for %s", (_, id, sets) => {
    expect(findItem(catalog, sets, id)).toBeUndefined();
  });

  it("prefers a piece when a collection shares its id", () => {
    expect(findItem(catalog, [{ ...set, id: A }], A)).toHaveProperty("piece");
  });
});

describe("verifiable", () => {
  it.each([
    ["cs_test_a1", ACCOUNT, true],
    ["pi_3Abc_9", ACCOUNT, true],
    ["free_" + "a".repeat(32), ACCOUNT, false],
    ["cs_", ACCOUNT, false],
    ["cs_test a1", ACCOUNT, false],
    ["cs_test_a1", "", false],
    ["cs_test_a1", "acct_", false]
  ])("session %j into %j is worth asking checkout about: %s", (session, account, worth) => {
    expect(verifiable(session, account)).toBe(worth);
  });
});

describe("paidBy", () => {
  const ID = "e".repeat(24);
  const good: Receipt = { paid: true, piece: ID, origin: ORIGIN, payment_intent: "pi_1", amount_usd: 2.5 };

  it("a paid receipt for this item in this store pays for it, at what it charged", () => {
    expect(paidBy(good, ID, ORIGIN)).toEqual({ tx: "pi_1", priceUsd: 2.5 });
  });

  it("a receipt without an amount counts as nothing charged", () => {
    expect(paidBy({ ...good, amount_usd: undefined }, ID, ORIGIN)).toEqual({ tx: "pi_1", priceUsd: 0 });
  });

  it.each([
    ["unpaid", { paid: false }],
    ["for another piece", { piece: "f".repeat(24) }],
    ["for no piece", { piece: undefined }],
    ["for another store", { origin: "https://other.workers.dev" }],
    ["with no payment", { payment_intent: undefined }],
    ["with an empty payment", { payment_intent: "" }]
  ])("a receipt %s pays for nothing", (_, overrides: Partial<Receipt>) => {
    expect(paidBy({ ...good, ...overrides }, ID, ORIGIN)).toBeNull();
  });
});
