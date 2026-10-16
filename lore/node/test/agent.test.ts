// XC-067: the owner's agents write into their own node at /agent, sealed to
// the owner's key; buyers on /mcp never see it (contracts/inbox.md).
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { Agent, Mac, connect, memory, open, ownerKey, workerFetch } from "./inbox";

let mac: Mac;

// A fresh Worker's first request can run past the per-test timeout; spend
// that wait here rather than in whichever test happens to run first.
beforeAll(async () => {
  mac = await Mac.pushed();
  await (await Agent.connect((await mac.mint()).token)).client.close();
}, 60_000);

async function setup() {
  const { id, token } = await mac.mint();
  return { id, token, agent: await Agent.connect(token) };
}

function post(path: string, token?: string, body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }): Promise<Response> {
  return workerFetch(`https://worker.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });
}

describe("/agent", () => {
  it("401s a missing, wrong, rotated-out or revoked key, pointing at the resource metadata", async () => {
    const { id, token } = await mac.mint();
    const wrong = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const rotated = await mac.rotate(id);
    const revoked = await mac.mint();
    await mac.revoke(revoked.id);
    for (const key of [undefined, "nope", wrong, token, revoked.token]) {
      const response = await post("/agent", key);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://worker.test/.well-known/oauth-protected-resource"');
      await response.text();
    }
    const response = await post("/agent", rotated);
    expect(response.status).toBe(200);
    await response.text();
  });

  it("takes the key in the address, so a connector needs only the URL", async () => {
    const { token } = await mac.mint();
    const client = await connect(`https://worker.test/agent/${token}`);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("store");
    await client.close();
    const wrong = await post(`/agent/${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`);
    expect(wrong.status).toBe(401);
    await wrong.text();
    const deeper = await post(`/agent/${token}/x`);
    expect(deeper.status).not.toBe(200);
    await deeper.text();
  });

  it("serves the three write tools and says nothing is published without the owner", async () => {
    const { agent } = await setup();
    const { tools } = await agent.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["forget", "store", "stored"]);
    expect(agent.client.getInstructions()).toMatch(/nothing is ever published or sold without the owner's approval/);
  });

  it("is stateless: a bare tools/call works without initialize, and is never cached", async () => {
    const { token } = await setup();
    const response = await post("/agent", token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stored", arguments: {} } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json<{ result: { content: { text: string }[] } }>();
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ saved: 0, waiting: 0, keys: [] });
  });

  it("keeps the write tools off the buyer /mcp", async () => {
    const buyer = await connect("https://worker.test/mcp");
    const { tools } = await buyer.listTools();
    await buyer.close();
    expect(tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["store"]));
    expect(tools.map((tool) => tool.name).filter((name) => ["store", "stored", "forget"].includes(name))).toEqual([]);
  });
});

describe("store", () => {
  it("seals items the owner's key opens, and only that key", async () => {
    const { id, agent } = await setup();
    const result = await agent.store(memory({ key: " sync-pricing ", occurred_at: "2026-10-01" }), { title: "Coffee", content: "Oat flat white." });
    expect(result.isError).toBe(false);
    const saved = result.body.saved as { id: string; key: string; replaced: boolean }[];
    expect(saved[0]).toMatchObject({ key: "sync-pricing", replaced: false });
    expect(saved[1].key).toBe(saved[1].id);
    expect(saved[1].id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.body.note).toMatch(/private/);
    const items = await mac.opened(id);
    expect(items.map((item) => item.plain)).toEqual([
      { ...memory(), key: "sync-pricing", occurred_at: "2026-10-01" },
      { title: "Coffee", content: "Oat flat white.", topic: null, kind: null, key: saved[1].id, occurred_at: null }
    ]);
    const stranger = await ownerKey();
    const [first] = await mac.collect(id);
    await expect(open(stranger.privateKey, mac.key.publicKey, first.id, first.sealed)).rejects.toThrow();
  });

  it("replaces the waiting item saved under the same key, keeping its id", async () => {
    const { id, agent } = await setup();
    const [a] = (await agent.store(memory({ key: "k", content: "v1" }))).body.saved as { id: string }[];
    const [b] = (await agent.store(memory({ key: "k", content: "v2" }))).body.saved as { id: string; replaced: boolean }[];
    expect(b).toMatchObject({ id: a.id, replaced: true });
    expect(await mac.opened(id)).toMatchObject([{ id: a.id, plain: { content: "v2" } }]);
  });

  it("drops the payload on confirm, and a later save starts a new item", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    const [item] = await mac.collect(id);
    await mac.confirm([item]);
    expect(await mac.collect(id)).toEqual([]);
    expect((await agent.tool("stored", { keys: ["k", "never"] })).body).toMatchObject({
      saved: 1,
      waiting: 0,
      keys: [
        { key: "k", state: "received" },
        { key: "never", state: "unknown", saved_at: null }
      ]
    });
    const row = await env.LORE_DB.prepare("SELECT state, sealed, received_at FROM inbox WHERE id = ?").bind(item.id).first();
    expect(row).toMatchObject({ state: "received", sealed: null, received_at: expect.any(String) as string });
    const again = await agent.store(memory({ key: "k" }));
    expect((again.body.saved as { id: string; replaced: boolean }[])[0].replaced).toBe(false);
    expect((await mac.collect(id))[0].id).not.toBe(item.id);
  });

  it("keeps a re-save made between collect and confirm for the next collection", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k", content: "v1" }));
    const collected = await mac.collect(id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await agent.store(memory({ key: "k", content: "v2" }));
    await mac.confirm(collected);
    expect(await mac.opened(id)).toMatchObject([{ plain: { content: "v2" } }]);
  });

  it("keeps no plaintext in any table", async () => {
    const { agent } = await setup();
    const secret = { title: "PLAINTEXT-TITLE", content: "PLAINTEXT-CONTENT", topic: "PLAINTEXT-TOPIC", key: "PLAINTEXT-KEY" };
    await agent.store(secret);
    await agent.tool("forget", { key: "PLAINTEXT-FORGET" });
    const { results: tables } = await env.LORE_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'"
    ).all<{ name: string }>();
    expect(tables.map(({ name }) => name)).toEqual(expect.arrayContaining(["agents", "inbox", "inbox_windows"]));
    const dump = JSON.stringify(await Promise.all(tables.map(async ({ name }) => (await env.LORE_DB.prepare(`SELECT * FROM "${name}"`).all()).results)));
    expect(dump).not.toContain("PLAINTEXT");
  });

  it("refuses every write until a push has left the owner's key", async () => {
    const { agent } = await setup();
    await env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'inbox_public_key'").run();
    try {
      for (const result of [await agent.store(memory()), await agent.tool("forget", { key: "k" }), await agent.tool("stored", {})]) {
        expect(result).toMatchObject({ isError: true, body: { error: "Lore isn't ready for agents on this store yet" } });
      }
    } finally {
      await mac.push();
    }
  });
});

describe("a push", () => {
  it("replaces publications and node_settings and leaves agents and the inbox intact", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "kept" }));
    await env.LORE_DB.batch([
      env.LORE_DB.prepare("DROP TABLE IF EXISTS publications"),
      env.LORE_DB.prepare(
        "CREATE TABLE publications (public_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', teaser TEXT NOT NULL DEFAULT '', sample TEXT NOT NULL DEFAULT '', useful_if TEXT NOT NULL DEFAULT '', not_useful_if TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')"
      )
    ]);
    await mac.push({ listed_name: "After a push" });
    expect(await mac.opened(id)).toMatchObject([{ plain: { key: "kept" } }]);
    expect((await agent.store(memory({ key: "kept", content: "newer" }))).body.saved).toMatchObject([{ replaced: true }]);
  });
});

describe("forget", () => {
  it("drops a waiting item the Mac never saw", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    expect((await agent.tool("forget", { key: "k" })).body).toEqual({ forgotten: true });
    expect(await mac.collect(id)).toEqual([]);
    expect((await agent.tool("stored", { keys: ["k"] })).body.keys).toMatchObject([{ key: "k", state: "forgotten" }]);
  });

  it("sends a sealed forget for a memory the Mac already has, which stays forgotten once received", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    await mac.confirm(await mac.collect(id));
    await agent.tool("forget", { key: "k" });
    const [item] = await mac.opened(id);
    expect(item).toMatchObject({ state: "forgotten", plain: { key: "k", forget: true } });
    await mac.confirm(await mac.collect(id));
    expect((await agent.tool("stored", { keys: ["k"] })).body.keys).toMatchObject([{ key: "k", state: "forgotten" }]);
  });

  it("turns a newer waiting version into a forget when an older one was received", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k", content: "v1" }));
    await mac.confirm(await mac.collect(id));
    await agent.store(memory({ key: "k", content: "v2" }));
    await agent.tool("forget", { key: "k" });
    expect(await mac.opened(id)).toMatchObject([{ state: "forgotten", plain: { key: "k", forget: true } }]);
  });

  it("keeps a forget for a key it has never seen, for the Mac to apply", async () => {
    const { id, agent } = await setup();
    await agent.tool("forget", { key: "elsewhere" });
    expect(await mac.opened(id)).toMatchObject([{ state: "forgotten", plain: { key: "elsewhere", forget: true } }]);
  });

  it("keeps each agent's keys apart", async () => {
    const { id, agent } = await setup();
    const other = await mac.mint("Claude", "claude");
    const claude = await Agent.connect(other.token);
    await agent.store(memory({ key: "k", content: "mine" }));
    await claude.store(memory({ key: "k", content: "theirs" }));
    await claude.tool("forget", { key: "k" });
    expect((await mac.opened(id)).map((item) => item.plain.content)).toEqual(["mine"]);
    expect(await mac.collect(other.id)).toEqual([]);
  });
});

describe("limits", () => {
  it("names the field limit it refuses", async () => {
    const { agent } = await setup();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ items: [memory({ title: "x".repeat(201) })] }, /title must be 1–200 characters/],
      [{ items: [memory({ content: "x".repeat(20_001) })] }, /content must be 1–20,000 characters/],
      [{ items: [memory({ topic: "x".repeat(81) })] }, /topic must be at most 80 characters/],
      [{ items: [memory({ key: "   " })] }, /key must be 1–120 characters/],
      [{ items: [memory({ kind: "rumor" })] }, /kind/],
      [{ items: [] }, /store takes 1–20 items/],
      [{ items: Array.from({ length: 21 }, () => memory()) }, /store takes 1–20 items/]
    ];
    for (const [args, message] of cases) {
      const result = await agent.tool("store", args);
      expect(result.isError).toBe(true);
      expect(result.body.error).toMatch(message);
    }
  });

  it("counts characters as code points", async () => {
    const { id, agent } = await setup();
    expect((await agent.store(memory({ title: "🚀".repeat(200) }))).isError).toBe(false);
    expect((await mac.opened(id))[0].plain.title).toBe("🚀".repeat(200));
  });

  it("holds an agent to 100 writes an hour, forgets included", async () => {
    const { agent } = await setup();
    for (let i = 0; i < 5; i++) expect((await agent.store(...Array.from({ length: 20 }, () => memory()))).isError).toBe(false);
    expect((await agent.store(memory())).body.error).toMatch(/100 writes an hour/);
    expect((await agent.tool("forget", { key: "k" })).body.error).toMatch(/100 writes an hour/);
  });

  it("holds the limit when writes arrive at once", async () => {
    const { token } = await setup();
    const agents = await Promise.all(Array.from({ length: 6 }, () => Agent.connect(token)));
    const results = await Promise.all(agents.map((agent) => agent.store(...Array.from({ length: 20 }, () => memory()))));
    expect(results.filter((result) => !result.isError)).toHaveLength(5);
    expect(results.find((result) => result.isError)?.body.error).toMatch(/100 writes an hour/);
  });

  it("holds an agent to 1,000 writes a day, and a refused call spends nothing", async () => {
    const { id, agent } = await setup();
    await env.LORE_DB.prepare("INSERT INTO inbox_windows VALUES (?, 'day', ?, 999)").bind(id, new Date().toISOString()).run();
    expect((await agent.store(memory(), memory())).body.error).toMatch(/1,000 writes a day/);
    expect((await agent.store(memory())).isError).toBe(false);
    expect((await agent.store(memory())).body.error).toMatch(/1,000 writes a day/);
  });

  it("holds the node to 2,000 waiting items, while replacements still go through", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    const { n } = (await env.LORE_DB.prepare("SELECT count(*) AS n FROM inbox WHERE sealed IS NOT NULL").first<{ n: number }>())!;
    await env.LORE_DB.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) " +
        "INSERT INTO inbox (id, agent, key_hash, state, sealed, saved_at) SELECT printf('filler%026x', i), 'filler', printf('%064x', i), 'waiting', 'x', ? FROM n"
    )
      .bind(2_000 - n, new Date().toISOString())
      .run();
    try {
      expect((await agent.store(memory())).body.error).toMatch(/2,000 waiting items/);
      expect((await agent.store(memory({ key: "k", content: "v2" }))).isError).toBe(false);
    } finally {
      await env.LORE_DB.prepare("DELETE FROM inbox WHERE agent = 'filler'").run();
    }
    expect(await mac.collect(id)).toHaveLength(1);
  });
});

describe("retention", () => {
  it("drops payloads still waiting after 30 days at the next write", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ title: "old" }));
    await env.LORE_DB.prepare("UPDATE inbox SET saved_at = ? WHERE agent = ?").bind(new Date(Date.now() - 31 * 86_400_000).toISOString(), id).run();
    await agent.store(memory({ title: "new" }));
    expect((await mac.opened(id)).map((item) => item.plain.title)).toEqual(["new"]);
  });

  it("forgets what the Mac received after 90 days, keeping newer records", async () => {
    const { id, agent } = await setup();
    await agent.store(memory({ key: "old" }));
    await agent.store(memory({ key: "recent" }));
    await mac.confirm(await mac.collect(id));
    await env.LORE_DB.prepare("UPDATE inbox SET received_at = ? WHERE rowid = (SELECT min(rowid) FROM inbox WHERE agent = ?)")
      .bind(new Date(Date.now() - 91 * 86_400_000).toISOString(), id)
      .run();
    await agent.store(memory({ key: "next" }));
    const { body } = await agent.tool("stored", { keys: ["old", "recent"] });
    expect((body.keys as { state: string }[]).map((key) => key.state)).toEqual(["unknown", "received"]);
  });
});
