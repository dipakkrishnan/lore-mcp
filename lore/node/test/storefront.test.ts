import { describe, expect, it } from "vitest";
import { publicationPage, storefront, unlockedPage } from "../src/storefront.js";

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
const store = { name: "Dipak’s Working Lore", priceUsd: 0.01, origin: "https://lore.example.workers.dev", test: false };
const piece = { ...catalog.topics["team scaling"][0], topic: "team scaling", section: 0 };
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

  it("falls back to a generic name for an unlisted store, without inventing a seller for agents", () => {
    const html = storefront(catalog, { ...store, name: "" });
    expect(html).toContain("<h1>A Lore store</h1>");
    expect(ld(html).itemListElement[0].item.offers).not.toHaveProperty("seller");
  });

  it("links a listed store to the marketplace and says nothing for an unlisted one", () => {
    expect(storefront(catalog, store)).toContain(`<a class="listed" href="https://yourlore.dev/marketplace">`);
    expect(storefront(catalog, { ...store, name: "" })).not.toContain("Listed on Lore marketplace");
  });

  it("marks a test store and offers nothing for sale to agents", () => {
    const html = storefront(catalog, { ...store, test: true });
    expect(html).toContain("This is a test store");
    expect(ld(html).itemListElement[0].item).not.toHaveProperty("offers");
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

  it("renders the owner's sample and fit lines, escaped, and describes the piece by its sample", () => {
    const html = publicationPage(
      { ...piece, sample: "First <b>paragraph</b>.\n\nSecond one.", useful_if: "you hire <fast>", not_useful_if: "you're solo" },
      store
    );
    expect(html).toContain("<h2>Free sample</h2><blockquote><p>First &lt;b&gt;paragraph&lt;/b&gt;.</p><p>Second one.</p></blockquote>");
    expect(html).toContain("Useful if you hire &lt;fast&gt;");
    expect(html).toContain("Not useful if you&#39;re solo");
    expect(html).not.toContain("<b>paragraph");
    expect(html).toContain('<meta property="og:description" content="First &lt;b&gt;paragraph&lt;/b&gt;. Second one.">');
  });

  it("renders without a sample or fit lines exactly as before", () => {
    const html = publicationPage(piece, store);
    expect(html).not.toContain("Free sample");
    expect(html).not.toContain('class="fit"');
    expect(html).toContain("A firsthand piece by Dipak’s Working Lore, for sale on Lore.");
  });

  it("gives a person a prompt to hand their agent and a way to share the page", () => {
    const html = publicationPage(piece, store);
    const url = `https://lore.example.workers.dev/p/${A}`;
    expect(html).toContain(`data-copy="Buy this piece from Lore for me: ${url}"`);
    expect(html).toContain(`data-copy="${url}"`);
    expect(html).toContain("<button data-share>Share</button>");
    expect(html).toContain("goes straight to the seller");
    expect(publicationPage(piece, { ...store, test: true })).toContain("only a rehearsal");
  });

  it("puts a card button first when the store takes cards, posting only the store and piece", () => {
    const html = publicationPage(piece, { ...store, priceUsd: 3, checkout: "https://checkout.example" });
    expect(html).toContain(
      `<form method="post" action="https://checkout.example/create"><input type="hidden" name="origin" value="https://lore.example.workers.dev"><input type="hidden" name="id" value="${A}"><button class="primary card" type="submit">Buy for $3.00</button></form>`
    );
    expect(html.indexOf("Buy for $3.00")).toBeLessThan(html.indexOf("Or buy it with your AI agent"));
    expect(html).toContain("Lore never holds it");
    expect(publicationPage(piece, { ...store, priceUsd: 3, checkout: "https://checkout.example", test: true })).toContain("4242 4242 4242 4242");
    expect(publicationPage(piece, store)).not.toContain("<form");
  });

  it("carries the marketplace badge only while the store is listed", () => {
    expect(publicationPage(piece, store)).toContain("Listed on Lore marketplace");
    expect(publicationPage(piece, { ...store, name: "" })).not.toContain("Listed on Lore marketplace");
  });

  it("shows a receipt problem without the piece", () => {
    expect(publicationPage(piece, store, "No <payment> found")).toContain('<p class="notice">No &lt;payment&gt; found</p>');
  });
});

describe("unlockedPage", () => {
  it("shows the paid title and text, escaped", () => {
    const html = unlockedPage(piece, store, { title: "Hire <managers>", content: "First.\n\n<script>x</script>" });
    expect(html).toContain("Hire &lt;managers&gt;");
    expect(html).toContain("<p>First.</p><p>&lt;script&gt;x&lt;/script&gt;</p>");
    expect(html).toContain("Thanks for buying");
  });
});
