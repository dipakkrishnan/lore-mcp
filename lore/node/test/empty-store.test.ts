// XC-069: a store put online only so its owner's agents can save to it. The owner's push says
// `selling = false`, so a buyer sees the same four tools and an empty catalog, every sale is
// refused with one stable error, and the store's pages offer nothing; the owner's agents still
// save. Selling is the owner's choice, not the wallet's: a store that sells only by card has no
// wallet and keeps selling by card, as it always has.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TOOL_NAMES } from "../scripts/surface";
import { newTicketId } from "../src/answer-state";
import { mockFacilitator } from "./facilitator";
import { Agent, Mac, connect, memory, workerFetch } from "./inbox";
import { FIXTURE_PUBLICATION_ID } from "./setup";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

// Whatever .dev.vars holds, if anything: this suite also runs with no LORE_WALLET at all.
const WALLET = env.LORE_WALLET;
const PAYOUT = "0x000000000000000000000000000000000000dEaD";
const ACCOUNT = "acct_1SellerAbc";
const TEASER = "a teaser that is safe to advertise";
const setWallet = (wallet: string | undefined) => {
  (env as { LORE_WALLET: string | undefined }).LORE_WALLET = wallet;
};
const NOTHING_FOR_SALE = { error: "nothing is for sale here yet", code: "nothing_for_sale" };

const textOf = (result: CallToolResult) => JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;
const page = (path: string, init?: RequestInit) => workerFetch(`https://worker.test${path}`, { redirect: "manual", ...init });

async function sales(): Promise<number> {
  const row = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales").first<{ n: number }>().catch(() => ({ n: 0 }));
  return row?.n ?? 0;
}

/** A buyer's agent on a fresh session, so the store's current settings decide what it serves. */
async function buyer<T>(use: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect("https://worker.test/mcp");
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

let mac: Mac;

beforeAll(async () => {
  mockFacilitator();
  mac = await Mac.pushed();
}, 30_000);

afterEach(() => {
  vi.restoreAllMocks();
  setWallet(WALLET);
});

afterAll(() => {
  setWallet(WALLET);
});

describe("the same store, open for sale", () => {
  it("serves its pieces before the owner takes it off sale", async () => {
    mockFacilitator();
    setWallet(PAYOUT);
    await mac.push({ selling: "true" });
    const piece = await page(`/p/${FIXTURE_PUBLICATION_ID}`);
    expect(piece.status).toBe(200);
    expect(await piece.text()).toContain(TEASER);
    const listing = await page(`/p/${FIXTURE_PUBLICATION_ID}.json`);
    expect(listing.status).toBe(200);
    await listing.text();
    await buyer(async (client) => {
      const catalog = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(catalog).toMatchObject({ for_sale: true, payout: PAYOUT });
      expect(JSON.stringify(catalog.topics)).toContain(FIXTURE_PUBLICATION_ID);
      const get = await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } });
      expect((get._meta?.["x402/error"] as { error: string }).error).toBe("PAYMENT_REQUIRED");
    });
  });
});

describe("a store online only for its owner's agents", () => {
  // A wallet set or not, the owner's choice decides: nothing is offered.
  for (const [label, wallet] of [["with no wallet", undefined], ["with a wallet", PAYOUT]] as const) {
    describe(label, () => {
      beforeAll(async () => {
        await mac.push({ selling: "false" });
      });

      it("lists the same four tools as any store", async () => {
        setWallet(wallet);
        const { tools } = await buyer((client) => client.listTools());
        expect(tools.map(({ name }) => name).sort()).toEqual([...TOOL_NAMES]);
      });

      it("answers discover with an empty catalog, no price and no payout", async () => {
        setWallet(wallet);
        const result = await buyer((client) => client.callTool({ name: "discover", arguments: {} }));
        expect(result.isError).toBeUndefined();
        expect(textOf(result)).toEqual({
          manifest_version: 1,
          publication_count: 0,
          topics: {},
          for_sale: false,
          disclosure: "Nothing is for sale here yet."
        });
      });

      it("refuses get and answer with one stable error, never a payment challenge", async () => {
        setWallet(wallet);
        const fetchSpy = mockFacilitator();
        await buyer(async (client) => {
          for (const [name, args] of [
            ["get", { id: FIXTURE_PUBLICATION_ID }],
            ["answer", { question: "How do I price a sync placement?" }]
          ] as const) {
            const result = await client.callTool({ name, arguments: args });
            expect(result.isError, name).toBe(true);
            expect(result._meta?.["x402/error"], name).toBeUndefined();
            expect(textOf(result), name).toEqual(NOTHING_FOR_SALE);
          }
          const damaged = await client.callTool({ name: "get", arguments: { id: "000000000000000000000000" } });
          expect(JSON.stringify(damaged)).toMatch(/invalid publication id/);
          const result = await client.callTool({ name: "result", arguments: { ticket: newTicketId() } });
          expect(result.isError).toBe(true);
          expect(textOf(result)).toHaveProperty("error");
        });
        expect(settlementsOf(fetchSpy)).toEqual([]);
        expect(await sales()).toBe(0);
      });

      it("serves its front page saying nothing is for sale, and 404s every piece", async () => {
        setWallet(wallet);
        const front = await page("/");
        const body = await front.text();
        expect(front.status).toBe(200);
        expect(body).toContain("Nothing for sale yet.");
        for (const offered of ["USDC", TEASER, "For agents", "/mcp"]) expect(body).not.toContain(offered);
        for (const [path, init] of [
          [`/p/${FIXTURE_PUBLICATION_ID}`],
          [`/p/${FIXTURE_PUBLICATION_ID}.json`],
          [`/p/${FIXTURE_PUBLICATION_ID}/free`, { method: "POST" }],
          ["/p/not-a-piece"]
        ] as [string, RequestInit?][]) {
          const response = await page(path, init);
          const text = await response.text();
          expect(response.status, path).toBe(404);
          expect(text, path).not.toContain(TEASER);
          expect(text, path).not.toContain("the secret owner-approved content");
        }
        expect(await sales()).toBe(0);
      });

      it("takes the owner's agents' saves", async () => {
        setWallet(wallet);
        const { id, token } = await mac.mint();
        const agent = await Agent.connect(token);
        try {
          const saved = await agent.store(memory({ key: "first-save" }));
          expect(saved.isError).toBe(false);
          const [item] = await mac.opened(id);
          expect(item.plain).toMatchObject({ title: memory().title, key: "first-save" });
        } finally {
          await agent.client.close();
        }
      });
    });
  }
});

describe("a store that sells only by card, with no wallet", () => {
  // MON-040 and XC-039: cards charge the seller's Stripe account directly, so no wallet is involved.
  beforeAll(async () => {
    await mac.push({ stripe_account: ACCOUNT, price_usd: "3.000000" });
  });

  it("offers each piece by card on its page, and to Lore's checkout", async () => {
    setWallet(undefined);
    const piece = await page(`/p/${FIXTURE_PUBLICATION_ID}`);
    const html = await piece.text();
    expect(piece.status).toBe(200);
    expect(html).toContain('action="https://checkout.test/create"');
    expect(html).toContain("Buy for $3");
    const listing = await page(`/p/${FIXTURE_PUBLICATION_ID}.json`);
    expect(listing.status).toBe(200);
    // Exactly what checkout reads before charging: no wallet anywhere in it.
    expect(await listing.json()).toEqual({ id: FIXTURE_PUBLICATION_ID, teaser: TEASER, price_usd: 3, stripe_account: ACCOUNT, test: true });
  });

  it("still gives its free copies", async () => {
    setWallet(undefined);
    await mac.push({ stripe_account: ACCOUNT, price_usd: "3.000000", free_copies: "1" });
    const free = await page(`/p/${FIXTURE_PUBLICATION_ID}/free`, { method: "POST" });
    expect(free.status).toBe(303);
    expect(free.headers.get("location")).toMatch(new RegExp(`^/p/${FIXTURE_PUBLICATION_ID}\\?session_id=free_[0-9a-f]{32}$`));
  });

  it("lists its pieces to agents and sends them to the page, without ever asking a wallet to be paid", async () => {
    setWallet(undefined);
    const fetchSpy = mockFacilitator();
    await buyer(async (client) => {
      const catalog = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(catalog).toMatchObject({ for_sale: true, price_usd: 3 });
      expect(catalog).not.toHaveProperty("payout");
      expect(JSON.stringify(catalog.topics)).toContain(FIXTURE_PUBLICATION_ID);
      const get = await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } });
      expect(get.isError).toBe(true);
      expect(get._meta?.["x402/error"]).toBeUndefined();
      expect(textOf(get)).toMatchObject({ code: "cards_only" });
    });
    expect(settlementsOf(fetchSpy)).toEqual([]);
  });
});

describe("a store whose settings can't be read", () => {
  it("sells nothing for that session, wallet or not", async () => {
    setWallet(PAYOUT);
    await env.LORE_DB.exec("DROP TABLE IF EXISTS node_settings");
    try {
      const catalog = await buyer(async (client) => textOf(await client.callTool({ name: "discover", arguments: {} })));
      expect(catalog).toMatchObject({ for_sale: false, topics: {} });
      const piece = await page(`/p/${FIXTURE_PUBLICATION_ID}`);
      expect(piece.status).toBe(404);
      expect(await piece.text()).not.toContain(TEASER);
    } finally {
      await mac.push({ selling: "true" });
    }
  });
});

function settlementsOf(fetchSpy: ReturnType<typeof mockFacilitator>): string[] {
  return fetchSpy.mock.calls
    .map(([input]) => new URL(input instanceof Request ? input.url : input).pathname)
    .filter((path) => path === "/verify" || path === "/settle");
}
