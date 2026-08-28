// The root page is what "Open your store" opens; it must be a page a person can
// read, built from the same catalog agents get from `discover`.
import { describe, expect, it } from "vitest";
import { storefront } from "../../lore/node/src/storefront.js";

const catalog = {
  manifest_version: 1 as const,
  publication_count: 2,
  topics: {
    "team scaling": [
      { id: "a".repeat(24), teaser: "Why hire managers <before> ten engineers?", kind: "claim", updated_at: "2026-08-01" }
    ],
    pricing: [{ id: "b".repeat(24), teaser: "What a $0.01 floor protects", kind: "claim", updated_at: "2026-08-02" }]
  }
};

describe("storefront", () => {
  it("lists every teaser under its topic with the price and the agent endpoint", () => {
    const html = storefront(catalog, 0.01, "Base", "https://lore.example.workers.dev");
    expect(html).toContain("2 publications for sale");
    expect(html).toContain("<h2>team scaling</h2>");
    expect(html).toContain("What a $0.01 floor protects");
    expect(html).toContain("https://lore.example.workers.dev/mcp");
    expect(html).toContain("$0.01 each");
  });

  it("escapes owner text so a teaser cannot inject markup", () => {
    expect(storefront(catalog, 0.01, "Base", "https://x")).toContain("&lt;before&gt;");
    expect(storefront(catalog, 0.01, "Base", "https://x")).not.toContain("<before>");
  });

  it("says so when nothing is for sale yet", () => {
    expect(storefront({ manifest_version: 1, publication_count: 0, topics: {} }, 0.01, "Base", "https://x")).toContain("Nothing for sale yet");
  });
});
