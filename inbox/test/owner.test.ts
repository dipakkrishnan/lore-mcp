import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { b64url } from "../src/token";
import { Agent, Owner, call, memory, stub } from "./helpers";

type Summary = { owner: string; waiting: number; agents: { id: string; name: string; app: string; saved: number; waiting: number; revoked: boolean }[] };

describe("POST /owners", () => {
  it("registers an owner and returns a token that embeds the owner id", async () => {
    const owner = await Owner.register();
    expect(owner.id).toMatch(/^[0-9a-f]{32}$/);
    expect(owner.token).toMatch(new RegExp(`^lore_owner_${owner.id}_[A-Za-z0-9_-]{43}$`));
  });

  it("stores only a hash of the secret", async () => {
    const owner = await Owner.register();
    const secret = owner.token.split("_").slice(3).join("_");
    await runInDurableObject(stub(owner.id), (_instance, state) => {
      const rows = JSON.stringify(state.storage.sql.exec("SELECT * FROM owner").toArray());
      expect(rows).not.toContain(secret);
    });
  });

  it("400s a public key that is not 32 bytes of base64url", async () => {
    const response = await call("/owners", undefined, { body: { public_key: "short" } });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });

  it("is rate-limited per IP", async () => {
    const body = { public_key: b64url(new Uint8Array(32)) };
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await call("/owners", undefined, { body, headers })).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("the owner API", () => {
  it("adds, lists, rotates and revokes agents", async () => {
    const owner = await Owner.register();
    const response = await owner.call("/agents", { body: { name: "Grok", app: "grok" } });
    expect(response.status).toBe(201);
    const added = await response.json<{ agent: Summary["agents"][0]; token: string; mcp_url: string }>();
    expect(added.mcp_url).toBe("https://inbox.test/mcp");
    expect(added.token).toMatch(new RegExp(`^lore_agent_${owner.id}_[A-Za-z0-9_-]{43}$`));
    expect(added.agent).toMatchObject({ name: "Grok", app: "grok", saved: 0, waiting: 0, revoked: false, last_saved_at: null });
    expect(added.agent.id).toMatch(/^[0-9a-f]{16}$/);

    const summary = await (await owner.call("")).json<Summary>();
    expect(summary).toMatchObject({ owner: owner.id, waiting: 0, agents: [{ id: added.agent.id, name: "Grok" }] });
    expect(JSON.stringify(summary)).not.toContain("token");

    const rotated = await owner.call(`/agents/${added.agent.id}/key`, { method: "POST" });
    expect(rotated.status).toBe(200);
    const { token } = await rotated.json<{ token: string }>();
    expect(token).not.toBe(added.token);
    await expect(Agent.connect(added.token)).rejects.toThrow();
    const agent = await Agent.connect(token);
    expect((await agent.store(memory())).isError).toBe(false);

    expect((await owner.call(`/agents/${added.agent.id}`, { method: "DELETE" })).status).toBe(204);
    await expect(Agent.connect(token)).rejects.toThrow();
    const after = await (await owner.call("")).json<Summary>();
    expect(after.agents[0]).toMatchObject({ revoked: true, waiting: 1, saved: 1 });
    expect(after.waiting).toBe(1);
    expect((await owner.call(`/agents/${added.agent.id}/key`, { method: "POST" })).status).toBe(409);
  });

  it("refuses an unknown agent, app or name", async () => {
    const owner = await Owner.register();
    expect((await owner.call("/agents/0123456789abcdef", { method: "DELETE" })).status).toBe(404);
    expect((await owner.call("/agents/0123456789abcdef/key", { method: "POST" })).status).toBe(404);
    expect((await owner.call("/agents", { body: { name: "Bard", app: "bard" } })).status).toBe(400);
    expect((await owner.call("/agents", { body: { name: "x".repeat(41), app: "other" } })).status).toBe(400);
    expect((await owner.call("/items?limit=201")).status).toBe(400);
    expect((await owner.call("/agents", { body: { name: "x".repeat(70_000), app: "other" } })).status).toBe(413);
  });

  it("401s a missing, wrong or agent token", async () => {
    const owner = await Owner.register();
    const { token } = await owner.agent();
    expect((await call("/owners/me")).status).toBe(401);
    const wrong = `${owner.token.slice(0, -1)}${owner.token.endsWith("A") ? "B" : "A"}`;
    expect((await call("/owners/me", wrong)).status).toBe(401);
    expect((await call("/owners/me", token)).status).toBe(401);
  });

  it("never lets one owner's token reach another owner's inbox", async () => {
    const [a, b] = await Promise.all([Owner.register(), Owner.register()]);
    const agentB = await Agent.connect((await b.agent()).token);
    await agentB.store(memory());
    const secretA = a.token.split("_").slice(3).join("_");
    const forged = `lore_owner_${b.id}_${secretA}`;
    expect((await call("/owners/me", forged)).status).toBe(401);
    expect((await call("/owners/me/items", forged)).status).toBe(401);
    expect(await a.items()).toEqual([]);
    const agentA = (await a.agent()).token;
    const forgedAgent = `lore_agent_${b.id}_${agentA.split("_").slice(3).join("_")}`;
    await expect(Agent.connect(forgedAgent)).rejects.toThrow();
    expect(await b.items()).toHaveLength(1);
  });

  it("erases everything on DELETE /owners/me", async () => {
    const owner = await Owner.register();
    const { token } = await owner.agent();
    await (await Agent.connect(token)).store(memory());
    expect((await owner.call("", { method: "DELETE" })).status).toBe(204);
    expect((await owner.call("")).status).toBe(401);
    await expect(Agent.connect(token)).rejects.toThrow();
    await runInDurableObject(stub(owner.id), async (_instance, state) => {
      expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'").toArray()).toEqual([]);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
