// XC-100: what the owner's pushed `node_settings` rows mean, and the fail-closed default when they can't be read.
// The stores built on them are covered through the Worker by the answer*, card and empty-store tests.
import { describe, expect, it } from "vitest";
import { readAnswerSettings } from "../../src/answer-state.js";
import { CLOSED, parseSettings } from "../../src/settings.js";

const rows = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => ({ key, value }));
const parse = (values: Record<string, string>) => parseSettings(rows(values));
const ON = { answer_enabled: "true", proxy_preamble: "I am Dipak's proxy.", answer_price_usd: "0.5" };

describe("parseSettings", () => {
  it("reads a store with nothing pushed as selling, at the deployed price, with nothing else on", () => {
    expect(parseSettings([])).toEqual({
      enabled: false,
      priceUsd: 0,
      proxy: "",
      listedName: "",
      stripeAccount: "",
      freeCopies: 0,
      supportEmail: "",
      publicationPriceUsd: 0,
      selling: true
    });
  });

  it("reads every pushed value", () => {
    expect(
      parse({
        ...ON,
        listed_name: "Dipak",
        stripe_account: "acct_1Abc",
        free_copies: "3",
        support_email: "help@example.com",
        price_usd: "0.75",
        selling: "true"
      })
    ).toEqual({
      enabled: true,
      priceUsd: 0.5,
      proxy: "I am Dipak's proxy.",
      listedName: "Dipak",
      stripeAccount: "acct_1Abc",
      freeCopies: 3,
      supportEmail: "help@example.com",
      publicationPriceUsd: 0.75,
      selling: true
    });
  });

  describe("the answer tier is on only when enabled, with a proxy and a positive price", () => {
    it.each([
      [ON, true],
      [{ ...ON, answer_enabled: "false" }, false],
      [{ ...ON, answer_enabled: "TRUE" }, false],
      [{ ...ON, answer_enabled: undefined }, false],
      [{ ...ON, proxy_preamble: "" }, false],
      [{ ...ON, proxy_preamble: "  \n " }, false],
      [{ ...ON, answer_price_usd: "0" }, false],
      [{ ...ON, answer_price_usd: "-1" }, false],
      [{ ...ON, answer_price_usd: "free" }, false],
      [{ ...ON, answer_price_usd: "Infinity" }, false],
      [{ ...ON, answer_price_usd: undefined }, false]
    ])("%j → %s", (values, enabled) => {
      const defined = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<string, string>;
      expect(parse(defined).enabled).toBe(enabled);
    });
  });

  it.each([
    ["3", 3],
    ["0", 0],
    ["-2", 0],
    ["2.5", 0],
    ["many", 0],
    ["", 0]
  ])("free_copies %j gives %d away", (value, copies) => {
    expect(parse({ free_copies: value }).freeCopies).toBe(copies);
  });

  it.each([
    ["0.75", 0.75],
    ["0", 0],
    ["-1", 0],
    ["NaN", 0],
    ["Infinity", 0],
    ["one dollar", 0]
  ])("price_usd %j sells a piece at %d (0: the deployed price)", (value, price) => {
    expect(parse({ price_usd: value }).publicationPriceUsd).toBe(price);
  });

  it.each([
    ["false", false],
    ["true", true],
    ["no", true],
    ["", true]
  ])("selling %j sells: %s (only an explicit false stops selling)", (value, selling) => {
    expect(parse({ selling: value }).selling).toBe(selling);
  });
});

describe("readAnswerSettings", () => {
  const db = (all: () => Promise<{ results: { key: string; value: string }[] }>) =>
    ({ prepare: () => ({ all }) }) as unknown as D1Database;

  it("reads the rows the query returns", async () => {
    await expect(readAnswerSettings(db(async () => ({ results: rows({ listed_name: "Dipak" }) })))).resolves.toMatchObject({
      listedName: "Dipak",
      selling: true
    });
  });

  it("fails closed when the settings can't be read: nothing sells, nothing answers", async () => {
    const settings = await readAnswerSettings(db(() => Promise.reject(new Error("no such table: node_settings"))));
    expect(settings).toEqual(CLOSED);
    expect(settings).toMatchObject({ selling: false, enabled: false });
    expect(settings).not.toBe(CLOSED);
  });
});
