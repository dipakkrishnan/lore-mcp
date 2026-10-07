import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const visit = (path: string, method = "GET") => exports.default.fetch(new Request(`https://worker.test${path}`, { method }));

describe("store pages", () => {
  it("serves the store and each piece without the title or the text", async () => {
    for (const path of ["/", `/p/${FIXTURE_PUBLICATION_ID}`, `/p/${FIXTURE_PUBLICATION_ID}/`]) {
      const response = await visit(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("a teaser that is safe to advertise");
      expect(html).not.toContain("Fixture Publication");
      expect(html).not.toContain("the secret owner-approved content");
    }
  });

  it("shows the owner's free sample on the piece page, never the paid text", async () => {
    const html = await (await visit(`/p/${FIXTURE_PUBLICATION_ID}`)).text();
    expect(html).toContain("a free sample the owner approved");
    expect(html).toContain("Useful if you are testing the free surface");
    expect(html).not.toContain("the secret owner-approved content");
  });

  it("answers HEAD with headers only", async () => {
    const response = await visit(`/p/${FIXTURE_PUBLICATION_ID}`, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("");
  });

  it("returns the store's own 404 page for anything under /p that isn't for sale", async () => {
    for (const path of [`/p/${"f".repeat(24)}`, "/p/abc", `/p/${FIXTURE_PUBLICATION_ID.toUpperCase()}`, "/p"]) {
      const response = await visit(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Not for sale here.");
    }
  });
});

describe("edge caching", () => {
  it("marks store pages public and everything else no-store", async () => {
    expect((await visit("/")).headers.get("cache-control")).toBe("public, max-age=60");
    for (const path of ["/mcp", "/elsewhere"]) {
      expect((await visit(path)).headers.get("cache-control")).toMatch(/no-store|no-cache/);
    }
  });
});
