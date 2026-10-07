import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const visit = (path: string, method = "GET") => exports.default.fetch(new Request(`https://worker.test${path}`, { method }));
const views = async () =>
  (await env.LORE_DB.prepare("SELECT views FROM page_views WHERE item_id = ?1").bind(FIXTURE_PUBLICATION_ID).first<{ views: number }>().catch(() => null))?.views ?? 0;

describe("page views", () => {
  it("counts a person opening a piece's page, and nothing else", async () => {
    const before = await views();
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`);
    await vi.waitFor(async () => expect(await views()).toBe(before + 1));
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`, "HEAD");
    await visit(`/p/${FIXTURE_PUBLICATION_ID}.json`);
    await visit("/");
    await visit(`/p/${"f".repeat(24)}`);
    await new Promise((settle) => setTimeout(settle, 100));
    expect(await views()).toBe(before + 1);
  });

  it("keeps a count per piece and nothing about who looked", async () => {
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`);
    await vi.waitFor(async () => expect(await views()).toBeGreaterThan(0));
    const { results } = await env.LORE_DB.prepare("PRAGMA table_info(page_views)").all<{ name: string }>();
    expect(results.map((column) => column.name)).toEqual(["item_id", "views"]);
  });
});
