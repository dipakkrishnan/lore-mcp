import assert from "node:assert/strict";
import { test } from "node:test";
import { marketplacePage } from "../src/worker.js";

const seller = { name: "Dipak", store: "https://lore.example.workers.dev/", network: "eip155:8453", topics: ["pricing"], publications: 3, price_usd: 0.01 };

test("lists a well-formed seller and escapes what they wrote", () => {
  const html = marketplacePage({ sellers: [{ ...seller, name: "<b>Dipak</b>" }] });
  assert.match(html, /&lt;b&gt;Dipak&lt;\/b&gt;/);
  assert.match(html, /3 pieces · \$0\.01 each/);
  assert.doesNotMatch(html, /test store/);
});

test("drops entries that are malformed or whose store isn't https", () => {
  const html = marketplacePage({
    sellers: [
      seller,
      { ...seller, name: "Script", store: "javascript:alert(1)" },
      { ...seller, name: "No price", price_usd: undefined },
      { ...seller, name: "String price", price_usd: "0.01" },
      { ...seller, name: "Loose topics", topics: "pricing" }
    ]
  });
  assert.doesNotMatch(html, /javascript:|No price|String price/);
  assert.match(html, /Loose topics/);
});

test("shows a seller's collections and drops malformed ones", () => {
  const collections = [
    { title: "<i>China</i> industrial policy", price_usd: 40, pieces: 12 },
    { title: "Unpriced", price_usd: 0, pieces: 2 },
    { title: "String price", price_usd: "5", pieces: 2 },
    { price_usd: 5, pieces: 2 }
  ];
  const html = marketplacePage({ sellers: [{ ...seller, collections }] });
  assert.match(html, /3 pieces · 1 collection · \$0\.01 each/);
  assert.match(html, /&lt;i&gt;China&lt;\/i&gt; industrial policy<span>12 pieces · \$40\.00<\/span>/);
  assert.doesNotMatch(html, /Unpriced|String price/);
});

test("says nothing about collections a seller doesn't have", () => {
  const html = marketplacePage({ sellers: [{ ...seller, collections: "shelf" }] });
  assert.doesNotMatch(html, /<ul class="collections">|· [0-9]+ collection/);
});

test("survives a list that isn't shaped like one", () => {
  assert.match(marketplacePage({ sellers: {} }), /No stores are listed yet/);
  assert.match(marketplacePage(null), /can't be loaded right now/);
});

test("labels a store on the test network", () => {
  assert.match(marketplacePage({ sellers: [{ ...seller, network: "eip155:84532" }] }), /test store · 3 pieces/);
});

test("serves the list itself at /marketplace.json", async (t) => {
  const { default: worker } = await import("../src/worker.js");
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ sellers: [seller] })));
  const response = await worker.fetch(new Request("https://yourlore.dev/marketplace.json"), {});
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal((await response.json()).sellers[0].name, "Dipak");
});
