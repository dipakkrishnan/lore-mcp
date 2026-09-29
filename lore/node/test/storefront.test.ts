import { describe, expect, it } from "vitest";
import { publicationPage, storefront } from "../src/storefront.js";

const A = "a".repeat(24);
const catalog = {
  manifest_version: 1 as const,
  publication_count: 2,
  topics: {
    "team scaling": [
      { id: A, teaser: "Why hire managers <before> ten engineers?", kind: "claim", updated_at: "2026-08-01" }
    ],
    pricing: [{ id: "b".repeat(24), teaser: "What a $0.01 floor protects", kind: "content", updated_at: "2026-08-02" }]
  }
};
const store = { name: "Dipak’s Working Lore", priceUsd: 0.01, origin: "https://lore.example.workers.dev" };
const piece = { ...catalog.topics["team scaling"][0], topic: "team scaling" };
type Ld = { "@type": string; name: string; itemListElement: { item: { offers: object } }[]; offers: { seller: { name: string } } };
const ld = (html: string) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1]) as Ld;

describe("storefront", () => {
  it("names the seller and lists every piece by its teaser, with its price and page", () => {
    const html = storefront(catalog, store);
    expect(html).toContain("<h1>Dipak’s Working Lore</h1>");
    expect(html).toContain("2 pieces of firsthand experience, $0.01 each");
    expect(html).toContain("<h3>What a $0.01 floor protects</h3>");
    expect(html).toContain(`href="/p/${A}"`);
    expect(html).toContain("https://lore.example.workers.dev/mcp");
  });

  it("describes every piece as a Product with an Offer for browsing agents", () => {
    const data = ld(storefront(catalog, store));
    expect(data["@type"]).toBe("ItemList");
    expect(data.itemListElement).toHaveLength(2);
    expect(data.itemListElement[0].item.offers).toMatchObject({ price: "0.01", priceCurrency: "USD" });
  });

  it("escapes owner text, including inside the structured data", () => {
    const html = storefront(catalog, store);
    expect(html).toContain("&lt;before&gt;");
    expect(html).not.toContain("<before>");
  });

  it("falls back to a generic name for an unlisted store", () => {
    expect(storefront(catalog, { ...store, name: "" })).toContain("<h1>A Lore store</h1>");
  });

  it("says when nothing is for sale", () => {
    expect(storefront({ manifest_version: 1, publication_count: 0, topics: {} }, store)).toContain("Nothing for sale yet");
  });
});

describe("publicationPage", () => {
  it("shows the teaser, topic and date and how to buy, never the text", () => {
    const html = publicationPage(piece, store);
    expect(html).toContain("Why hire managers &lt;before&gt; ten engineers?");
    expect(html).toContain("Aug 1, 2026");
    expect(html).toContain(`get {&quot;id&quot;: &quot;${A}&quot;}`);
    expect(html).toContain("<p class=\"amount\">$0.01</p>");
    const data = ld(html);
    expect(data).toMatchObject({ "@type": "Product", name: "Why hire managers <before> ten engineers?", category: "team scaling" });
    expect(data.offers.seller.name).toBe("Dipak’s Working Lore");
  });
});
