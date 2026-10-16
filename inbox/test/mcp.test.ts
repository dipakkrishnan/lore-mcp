import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Agent, Owner, call, memory, open, ownerKey, stub } from "./helpers";

async function setup() {
  const owner = await Owner.register();
  const { id, token } = await owner.agent();
  return { owner, id, token, agent: await Agent.connect(token) };
}

describe("/mcp", () => {
  it("401s without a valid agent token, pointing at the resource metadata", async () => {
    const owner = await Owner.register();
    for (const token of [undefined, "nope", owner.token]) {
      const response = await call("/mcp", token, { body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://inbox.test/.well-known/oauth-protected-resource"');
    }
  });

  it("serves the three tools and says nothing is published without the owner", async () => {
    const { agent } = await setup();
    const { tools } = await agent.client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["forget", "store", "stored"]);
    expect(agent.client.getInstructions()).toMatch(/nothing is ever published or sold without the owner's approval/);
  });

  it("is stateless: a bare tools/call works without initialize", async () => {
    const { token } = await setup();
    const response = await call("/mcp", token, {
      body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "stored", arguments: {} } },
      headers: { Accept: "application/json, text/event-stream" }
    });
    expect(response.status).toBe(200);
    const body = await response.json<{ result: { content: { text: string }[] } }>();
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ saved: 0, waiting: 0, keys: [] });
  });
});

describe("store", () => {
  it("seals items the owner's key opens, and only that key", async () => {
    const { owner, agent, id } = await setup();
    const result = await agent.store(memory({ key: " sync-pricing ", occurred_at: "2026-10-01" }), { title: "Coffee", content: "Oat flat white." });
    expect(result.isError).toBe(false);
    const saved = result.body.saved as { id: string; key: string; replaced: boolean }[];
    expect(saved[0]).toMatchObject({ key: "sync-pricing", replaced: false });
    expect(saved[1].key).toBe(saved[1].id);
    expect(result.body.note).toMatch(/private/);

    const items = await owner.opened();
    expect(items.map((item) => item.plain)).toEqual([
      { ...memory(), key: "sync-pricing", occurred_at: "2026-10-01" },
      { title: "Coffee", content: "Oat flat white.", topic: null, kind: null, key: saved[1].id, occurred_at: null }
    ]);
    expect((await owner.items())[0]).toMatchObject({ agent: id, state: "waiting" });

    const stranger = await ownerKey();
    await expect(open(stranger.privateKey, owner.key.publicKey, items[0].id, (await owner.items())[0].sealed)).rejects.toThrow();
  });

  it("replaces the waiting item saved under the same key, keeping its id", async () => {
    const { owner, agent } = await setup();
    const first = await agent.store(memory({ key: "k", content: "v1" }));
    const second = await agent.store(memory({ key: "k", content: "v2" }));
    const [a] = first.body.saved as { id: string }[];
    const [b] = second.body.saved as { id: string; replaced: boolean }[];
    expect(b).toMatchObject({ id: a.id, replaced: true });
    const items = await owner.opened();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: a.id, plain: { content: "v2" } });
  });

  it("drops the payload on received, and a later save starts a new item", async () => {
    const { owner, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    const [item] = await owner.items();
    expect((await owner.call("/items/received", { body: { ids: [item.id, "f".repeat(32)] } })).status).toBe(204);
    expect(await owner.items()).toEqual([]);
    expect((await agent.tool("stored", { keys: ["k", "never"] })).body).toMatchObject({
      saved: 1,
      waiting: 0,
      keys: [
        { key: "k", state: "received" },
        { key: "never", state: "unknown", saved_at: null }
      ]
    });
    await runInDurableObject(stub(owner.id), (_instance, state) => {
      expect(state.storage.sql.exec("SELECT state, sealed, received_at FROM items").toArray()).toEqual([
        { state: "received", sealed: null, received_at: expect.any(String) as string }
      ]);
    });
    const again = await agent.store(memory({ key: "k" }));
    expect((again.body.saved as { id: string; replaced: boolean }[])[0]).toMatchObject({ replaced: false });
    expect((await owner.items())[0].id).not.toBe(item.id);
  });

  it("filters the owner's items by agent and limit, oldest first", async () => {
    const { owner, agent, id } = await setup();
    const other = await Agent.connect((await owner.agent("Muse", "muse")).token);
    await agent.store(memory({ title: "one" }), memory({ title: "two" }));
    await other.store(memory({ title: "three" }));
    expect(await owner.items(`?agent=${id}`)).toHaveLength(2);
    expect(await owner.items("?limit=1")).toHaveLength(1);
    expect((await owner.opened()).map((item) => item.plain.title)).toEqual(["one", "two", "three"]);
  });

  it("keeps no plaintext in any table", async () => {
    const { owner, agent } = await setup();
    const secret = { title: "PLAINTEXT-TITLE", content: "PLAINTEXT-CONTENT", topic: "PLAINTEXT-TOPIC", key: "PLAINTEXT-KEY" };
    await agent.store(secret);
    await agent.tool("forget", { key: "PLAINTEXT-FORGET" });
    await runInDurableObject(stub(owner.id), (_instance, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'")
        .toArray();
      expect(tables.map(({ name }) => name).sort()).toEqual(["agents", "items", "owner", "windows"]);
      const dump = JSON.stringify(tables.map(({ name }) => state.storage.sql.exec(`SELECT * FROM ${name}`).toArray()));
      for (const value of [...Object.values(secret), "PLAINTEXT-FORGET", "PLAINTEXT"]) expect(dump).not.toContain(value);
    });
  });
});

describe("forget", () => {
  it("drops a waiting item the Mac never saw", async () => {
    const { owner, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    expect((await agent.tool("forget", { key: "k" })).body).toEqual({ forgotten: true });
    expect(await owner.items()).toEqual([]);
    expect((await agent.tool("stored", { keys: ["k"] })).body.keys).toMatchObject([{ key: "k", state: "forgotten" }]);
  });

  it("sends a sealed forget for a memory the Mac already has", async () => {
    const { owner, agent } = await setup();
    await agent.store(memory({ key: "k" }));
    await owner.call("/items/received", { body: { ids: (await owner.items()).map((item) => item.id) } });
    await agent.tool("forget", { key: "k" });
    const [item] = await owner.opened();
    expect(item).toMatchObject({ state: "forgotten", plain: { key: "k", forget: true } });
    await owner.call("/items/received", { body: { ids: [item.id] } });
    expect((await agent.tool("stored", { keys: ["k"] })).body.keys).toMatchObject([{ key: "k", state: "forgotten" }]);
  });

  it("turns a newer waiting version into a forget when an older one was received", async () => {
    const { owner, agent } = await setup();
    await agent.store(memory({ key: "k", content: "v1" }));
    await owner.call("/items/received", { body: { ids: (await owner.items()).map((item) => item.id) } });
    await agent.store(memory({ key: "k", content: "v2" }));
    await agent.tool("forget", { key: "k" });
    const items = await owner.opened();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: "forgotten", plain: { key: "k", forget: true } });
  });

  it("keeps a forget for a key it has never seen, for the Mac to apply", async () => {
    const { owner, agent } = await setup();
    await agent.tool("forget", { key: "elsewhere" });
    expect((await owner.opened())[0]).toMatchObject({ state: "forgotten", plain: { key: "elsewhere", forget: true } });
  });

  it("keeps each agent's keys apart", async () => {
    const { owner, agent } = await setup();
    const other = await Agent.connect((await owner.agent("Claude", "claude")).token);
    await agent.store(memory({ key: "k", content: "mine" }));
    await other.store(memory({ key: "k", content: "theirs" }));
    await other.tool("forget", { key: "k" });
    expect((await owner.opened()).map((item) => item.plain.content)).toEqual(["mine"]);
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
    const { owner, agent } = await setup();
    expect((await agent.store(memory({ title: "🚀".repeat(200) }))).isError).toBe(false);
    expect((await owner.opened())[0].plain.title).toBe("🚀".repeat(200));
  });

  it("holds an agent to 100 writes an hour", async () => {
    const { agent } = await setup();
    for (let i = 0; i < 5; i++) expect((await agent.store(...Array.from({ length: 20 }, () => memory()))).isError).toBe(false);
    const refused = await agent.store(memory());
    expect(refused).toMatchObject({ isError: true, body: { error: expect.stringMatching(/100 writes an hour/) as string } });
    expect((await agent.tool("forget", { key: "k" })).body.error).toMatch(/100 writes an hour/);
  });

  it("holds an agent to 1,000 writes a day, and a refused call spends nothing", async () => {
    const { owner, agent, id } = await setup();
    await runInDurableObject(stub(owner.id), (_instance, state) => {
      state.storage.sql.exec("INSERT INTO windows VALUES (?, 'day', ?, 999)", id, Date.now());
    });
    expect((await agent.store(memory(), memory())).body.error).toMatch(/1,000 writes a day/);
    expect((await agent.store(memory())).isError).toBe(false);
    expect((await agent.store(memory())).body.error).toMatch(/1,000 writes a day/);
  });

  it("holds an owner to 2,000 waiting items, while replacements still go through", async () => {
    const { owner, agent, id } = await setup();
    await agent.store(memory({ key: "k" }));
    await runInDurableObject(stub(owner.id), (_instance, state) => {
      state.storage.sql.exec(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1999) " +
          "INSERT INTO items (id, agent, key_hash, state, sealed, saved_at) SELECT printf('%032x', i), ?, printf('%064x', i), 'waiting', 'x', ? FROM n",
        id,
        new Date().toISOString()
      );
    });
    expect((await agent.store(memory())).body.error).toMatch(/2,000 waiting items/);
    expect((await agent.store(memory({ key: "k", content: "v2" }))).isError).toBe(false);
  });
});

describe("retention", () => {
  it("drops payloads still waiting after 30 days", async () => {
    const { owner, agent } = await setup();
    await agent.store(memory({ title: "old" }), memory({ title: "new" }));
    const inbox = stub(owner.id);
    const old = (await owner.opened()).find((item) => item.plain.title === "old")!;
    await runInDurableObject(inbox, async (_instance, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
      state.storage.sql.exec("UPDATE items SET saved_at = ? WHERE id = ?", new Date(Date.now() - 31 * 86_400_000).toISOString(), old.id);
    });
    expect(await runDurableObjectAlarm(inbox)).toBe(true);
    expect((await owner.opened()).map((item) => item.plain.title)).toEqual(["new"]);
    await runInDurableObject(inbox, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      expect(alarm).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    });
  });
});
