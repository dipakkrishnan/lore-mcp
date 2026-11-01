// XC-068: the owner's agents sign in to /agent with MCP OAuth. The page names the app and shows a code; the owner
// allows it on their Mac, which writes D1 as `wrangler d1 execute` does, and the page goes on by itself.
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Mac, connect, memory, workerFetch } from "./inbox";
import { b64url } from "../src/seal";

const ORIGIN = "https://worker.test";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
let mac: Mac;

beforeAll(async () => {
  mac = await Mac.pushed();
}, 60_000);

beforeEach(async () => {
  await env.LORE_DB.prepare("DELETE FROM sign_ins").run().catch(() => undefined);
});

const json = async <T>(response: Response) => (await response.json()) as T;

async function register(name = "Claude"): Promise<string> {
  const response = await workerFetch(`${ORIGIN}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] })
  });
  expect(response.status).toBe(201);
  return (await json<{ client_id: string }>(response)).client_id;
}

/** An app starting a sign-in: what its browser holds, and the code the page shows. */
class Browser {
  verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  cookie = "";
  handle = "";
  code = "";
  html = "";

  constructor(readonly client: string) {}

  async open(): Promise<Response> {
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(this.verifier))));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.client,
      redirect_uri: REDIRECT,
      state: "st4te",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${ORIGIN}/agent`,
      scope: "save"
    });
    const response = await workerFetch(`${ORIGIN}/authorize?${query}`);
    this.html = await response.text();
    this.cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    this.handle = this.html.match(/data-handle="([^"]+)"/)?.[1] ?? "";
    this.code = this.html.match(/<div class="pair"[^>]*>([^<]+)<\/div>/)?.[1] ?? "";
    return response;
  }

  async wait(cookie = this.cookie): Promise<{ state: string; redirect?: string }> {
    const body = new FormData();
    body.set("handle", this.handle);
    return json(await workerFetch(`${ORIGIN}/authorize/wait`, { method: "POST", body, headers: cookie ? { cookie } : {} }));
  }

  async tokens(redirect: string): Promise<{ access_token: string; refresh_token: string; scope: string }> {
    const code = new URL(redirect).searchParams.get("code") ?? "";
    const response = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: this.client, code_verifier: this.verifier });
    expect(response.status).toBe(200);
    return json(response);
  }
}

function token(form: Record<string, string>): Promise<Response> {
  return workerFetch(`${ORIGIN}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form) });
}

async function signedIn(name = "Claude") {
  const client = await register(name);
  const browser = new Browser(client);
  await browser.open();
  const agent = await mac.allow(browser.code);
  const done = await browser.wait();
  return { client, browser, agent: agent ?? "", done, tokens: await browser.tokens(done.redirect ?? "") };
}

describe("signing in", () => {
  it("points an agent with no key at the sign-in, from /agent to the authorization server", async () => {
    const challenge = await workerFetch(`${ORIGIN}/agent`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/agent"`);
    await challenge.text();
    const resource = await json<{ resource: string; authorization_servers: string[] }>(await workerFetch(`${ORIGIN}/.well-known/oauth-protected-resource/agent`));
    expect(resource).toMatchObject({ resource: `${ORIGIN}/agent`, authorization_servers: [ORIGIN] });
    const server = await json<Record<string, unknown>>(await workerFetch(`${ORIGIN}/.well-known/oauth-authorization-server`));
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ["S256"]
    });
  });

  it("shows the app's name and a code, and waits for the owner's Mac", async () => {
    const browser = new Browser(await register("Claude"));
    const page = await browser.open();
    expect(page.status).toBe(200);
    expect(browser.html).toContain("Claude wants to save to your Lore");
    expect(browser.html).toContain("Approve on your Mac");
    expect(browser.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{4}$/);
    const waiting = await env.LORE_DB.prepare("SELECT code, client, state FROM sign_ins").all();
    expect(waiting.results).toEqual([{ code: browser.code, client: "Claude", state: "pending" }]);
    expect(await browser.wait()).toEqual({ state: "pending" });
  });

  it("escapes the name an app gives itself", async () => {
    const browser = new Browser(await register("<script>x</script>"));
    await browser.open();
    expect(browser.html).not.toContain("<script>x");
    expect(browser.html).toContain("&lt;script&gt;x");
  });

  it("goes on by itself once the Mac allows it, and the agent saves with its token like a pasted key", async () => {
    const { done, tokens, agent } = await signedIn();
    expect(done.state).toBe("allowed");
    const back = new URL(done.redirect ?? "");
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st4te");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    expect(tokens.scope).toBe("save");
    const client = await connect(`${ORIGIN}/agent`, tokens.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["forget", "stored", "store"].sort());
    const saved = await client.callTool({ name: "store", arguments: { items: [memory()] } });
    expect(saved.isError).toBeFalsy();
    await client.close();
    const row = await env.LORE_DB.prepare("SELECT saved FROM agents WHERE id = ?").bind(agent).first<{ saved: number }>();
    expect(row?.saved).toBe(1);
    expect((await mac.collect(agent)).length).toBe(1);
  });

  it("finishes once: the sign-in is gone after it binds", async () => {
    const { browser } = await signedIn();
    expect(await browser.wait()).toEqual({ state: "expired" });
    expect((await env.LORE_DB.prepare("SELECT count(*) AS n FROM sign_ins").first<{ n: number }>())?.n).toBe(0);
  });

  it("finishes only in the browser that started it", async () => {
    const browser = new Browser(await register());
    await browser.open();
    await mac.allow(browser.code);
    expect(await browser.wait("")).toEqual({ state: "expired" });
  });

  it("sends the app back refused when the owner denies it, and binds nothing", async () => {
    const browser = new Browser(await register());
    await browser.open();
    const agents = (await env.LORE_DB.prepare("SELECT count(*) AS n FROM agents").first<{ n: number }>())?.n;
    await mac.deny(browser.code);
    const denied = await browser.wait();
    expect(denied.state).toBe("denied");
    expect(new URL(denied.redirect ?? "").searchParams.get("error")).toBe("access_denied");
    expect(await mac.allow(browser.code)).toBeNull();
    expect((await env.LORE_DB.prepare("SELECT count(*) AS n FROM agents").first<{ n: number }>())?.n).toBe(agents);
  });

  it("expires after ten minutes, and the Mac can't allow it then", async () => {
    const browser = new Browser(await register());
    await browser.open();
    await env.LORE_DB.prepare("UPDATE sign_ins SET expires_at = ?").bind(new Date(Date.now() - 1000).toISOString()).run();
    expect(await mac.allow(browser.code)).toBeNull();
    expect(await browser.wait()).toEqual({ state: "expired" });
  });

  it("holds only a few sign-ins waiting at once", async () => {
    const client = await register();
    for (let i = 0; i < 3; i++) expect((await new Browser(client).open()).status).toBe(200);
    const crowded = new Browser(client);
    expect((await crowded.open()).status).toBe(429);
    expect(crowded.handle).toBe("");
  });

  it("refreshes, and the new token saves too", async () => {
    const { client, tokens } = await signedIn();
    const refreshed = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client });
    expect(refreshed.status).toBe(200);
    const fresh = await json<{ access_token: string }>(refreshed);
    const agent = await connect(`${ORIGIN}/agent`, fresh.access_token);
    expect((await agent.listTools()).tools.length).toBe(3);
    await agent.close();
  });

  it("stops the access and refresh tokens of an agent disconnected in Lore", async () => {
    const { client, tokens, agent } = await signedIn();
    await mac.revoke(agent);
    const refused = await workerFetch(`${ORIGIN}/agent`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(refused.status).toBe(401);
    await refused.text();
    const refresh = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client });
    expect(refresh.status).toBe(400);
    expect((await json<{ error: string }>(refresh)).error).toBe("invalid_grant");
  });

  it("stops a signed-in agent whose key the Mac replaced, refresh included", async () => {
    const { client, tokens, agent } = await signedIn();
    await mac.rotate(agent);
    const refresh = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client });
    expect(refresh.status).toBe(400);
    await refresh.text();
  });

  it("keeps pasted keys working beside sign-ins", async () => {
    const { token: key } = await mac.mint();
    const client = await connect(`${ORIGIN}/agent/${key}`);
    expect((await client.listTools()).tools.length).toBe(3);
    await client.close();
  });
});
