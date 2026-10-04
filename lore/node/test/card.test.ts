import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const ORIGIN = "https://worker.test";
const ACCOUNT = "acct_1SellerAbc";

const visit = (path: string, method = "GET") => exports.default.fetch(new Request(`${ORIGIN}${path}`, { method }));
const receipt = (session = "cs_test_abc") => visit(`/p/${FIXTURE_PUBLICATION_ID}?session_id=${session}`);

/** Stubs Lore's checkout `/verify`; any other outbound fetch throws. */
function checkout(reply: Record<string, unknown> | "down" = {}) {
  const asked: URL[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(new Request(input, init).url);
    if (url.origin !== "https://checkout.test" || url.pathname !== "/verify") {
      throw new Error(`unexpected outbound fetch during test: ${url}`);
    }
    asked.push(url);
    if (reply === "down") return new Response("down", { status: 502 });
    return Response.json({ paid: true, piece: FIXTURE_PUBLICATION_ID, origin: ORIGIN, payment_intent: "pi_123", amount_usd: 3, ...reply });
  });
  return asked;
}

const cardSales = async () =>
  (await env.LORE_DB.prepare("SELECT item_id, price_usd, network, tx FROM sales WHERE network = 'stripe'").all()).results;

beforeEach(async () => {
  await env.LORE_DB.exec("CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  await env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('stripe_account', ?1)").bind(ACCOUNT).run();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'stripe_account'").run();
  await env.LORE_DB.exec("DELETE FROM sales WHERE network = 'stripe'").catch(() => undefined);
});

describe("the listing checkout reads", () => {
  it("holds only free fields, and no payee while the price is under the card minimum", async () => {
    const response = await visit(`/p/${FIXTURE_PUBLICATION_ID}.json`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: FIXTURE_PUBLICATION_ID,
      teaser: "a teaser that is safe to advertise",
      price_usd: 0.01,
      stripe_account: "",
      test: true
    });
    expect((await visit(`/p/${"f".repeat(24)}.json`)).status).toBe(404);
  });

  it("shows no card button on a store priced under $0.50", async () => {
    const html = await (await visit(`/p/${FIXTURE_PUBLICATION_ID}`)).text();
    expect(html).not.toContain("checkout.test");
    expect(html).not.toContain("Buy for");
  });
});

describe("a card receipt", () => {
  it("opens the paid piece privately and records the sale once, however often it's reopened", async () => {
    const asked = checkout();
    for (let visitNumber = 0; visitNumber < 2; visitNumber++) {
      const response = await receipt();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const html = await response.text();
      expect(html).toContain("the secret owner-approved content");
      expect(html).toContain("Fixture Publication");
    }
    expect(asked[0].searchParams.get("account")).toBe(ACCOUNT);
    expect(asked[0].searchParams.get("session")).toBe("cs_test_abc");
    expect(await cardSales()).toEqual([{ item_id: FIXTURE_PUBLICATION_ID, price_usd: 3, network: "stripe", tx: "pi_123" }]);
  });

  it("opens nothing for a session that is unpaid, for another piece or store, or unverifiable", async () => {
    for (const reply of [{ paid: false }, { piece: "1111111111111111807ae5f3" }, { origin: "https://other.test" }, { payment_intent: "" }, "down"] as const) {
      checkout(reply);
      const response = await receipt();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const html = await response.text();
      expect(html).not.toContain("the secret owner-approved content");
      expect(html).toContain("couldn&#39;t find a finished card payment");
      vi.restoreAllMocks();
    }
    expect(await cardSales()).toEqual([]);
  });

  it("asks nobody when the store takes no cards or the session is malformed", async () => {
    const asked = checkout();
    expect(await (await receipt("not-a-session")).text()).not.toContain("the secret owner-approved content");
    await env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'stripe_account'").run();
    expect(await (await receipt()).text()).not.toContain("the secret owner-approved content");
    expect(asked).toEqual([]);
  });

  it("leaves the plain page public and cacheable", async () => {
    const response = await visit(`/p/${FIXTURE_PUBLICATION_ID}`);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await response.text()).not.toContain("the secret owner-approved content");
  });
});
