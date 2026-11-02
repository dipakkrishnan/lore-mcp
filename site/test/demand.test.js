import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import contract from "../../contracts/usage_events.json" with { type: "json" };
import { agentFamily, countDemand } from "../src/demand.js";
import worker from "../src/worker.js";

afterEach(() => vi.restoreAllMocks());

const FAMILIES = [
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "claudebot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)", "claudebot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "claude-user"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "gptbot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "chatgpt-user"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", "oai-searchbot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "perplexitybot"],
  ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)", "perplexity-user"],
  ["Mozilla/5.0 (compatible; Grok/1.0; +https://x.ai)", "grok"],
  ["Mozilla/5.0 (compatible; xAI-Bot/1.0)", "grok"],
  ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "google"],
  ["Mozilla/5.0 (compatible; Google-Extended)", "google"],
  ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", "bingbot"],
  ["curl/8.7.1", "curl"],
  ["python-requests/2.32.3", "python"],
  ["Python-urllib/3.12", "python"],
  ["python-httpx/0.27.0", "python"],
  ["node", "node"],
  ["node-fetch/1.0 (+https://github.com/bitinn/node-fetch)", "node"],
  ["axios/1.7.2", "node"],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "browser"],
  ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "browser"],
  ["Go-http-client/2.0", "other"],
  ["", "other"],
  [null, "other"]
];

test("names a coarse agent family from the User-Agent", () => {
  for (const [userAgent, family] of FAMILIES) expect(agentFamily(userAgent), String(userAgent)).toBe(family);
});

test("every family it can name is one the relay keeps", () => {
  for (const [, family] of FAMILIES) expect(contract.site_events.values, family).toContain(family);
});

/** A relay binding and an execution context that record what was sent and what was left to finish after the response. */
function rig() {
  const sent = [];
  const pending = [];
  const relay = { RELAY: { count: async (...args) => void sent.push(args) } };
  return { sent, pending, env: relay, ctx: { waitUntil: (p) => pending.push(p) } };
}

test("sends two codes to the relay after the response, and nothing that names the caller", async () => {
  const { sent, pending, env: relay, ctx } = rig();
  const request = new Request("https://yourlore.dev/llms.txt?who=me", { headers: { "user-agent": "GPTBot/1.2", "cf-connecting-ip": "203.0.113.9", cookie: "a=b" } });
  countDemand("agent.llms", request, relay, ctx);
  expect(pending).toHaveLength(1);
  await Promise.all(pending);
  expect(sent).toEqual([["agent.llms", "gptbot"]]);
});

test("sends nothing without the relay binding or for a name the contract doesn't list, and a failed send stays quiet", async () => {
  const { sent, pending, env: relay, ctx } = rig();
  const request = new Request("https://yourlore.dev/llms.txt");
  countDemand("agent.llms", request, {}, ctx);
  countDemand("agent.keystroke", request, relay, ctx);
  expect(sent.length + pending.length).toBe(0);
  countDemand("agent.llms", request, { RELAY: { count: () => { throw new Error("down"); } } }, ctx);
  await Promise.all(pending);
});

test("counts each agent path once, and people's pages not at all", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ markets: [], sellers: [] }));
  const { sent, pending, env: relay, ctx } = rig();
  const assets = { fetch: async () => new Response("<!doctype html>home") };
  const paths = { "/llms.txt": "agent.llms", "/marketplace.jsonl": "agent.catalog", "/marketplace.json": "agent.json", "/marketplace/diving.json": "agent.json", "/sitemap.xml": "agent.sitemap" };
  for (const path of [...Object.keys(paths), "/robots.txt", "/marketplace", "/", "/marketplace/stats.json"]) {
    await worker.fetch(new Request(`https://yourlore.dev${path}`, { headers: { "user-agent": "ClaudeBot/1.0" } }), { ...relay, BIDS: env.BIDS, ASSETS: assets }, ctx);
  }
  await Promise.all(pending);
  expect(sent).toEqual(Object.values(paths).map((name) => [name, "claudebot"]));
});

test("counts a placed bid, and not a refused one", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ markets: [{ id: "rl-evals", name: "RL evals", tab: "AI" }], sellers: [] }));
  const { sent, pending, env: relay, ctx } = rig();
  const pass = { limit: async () => ({ success: true }) };
  const bid = (body) =>
    worker.fetch(new Request("https://yourlore.dev/bids", { method: "POST", headers: { "content-type": "application/json", "user-agent": "ChatGPT-User/1.0" }, body: JSON.stringify(body) }), { ...relay, BIDS: env.BIDS, BID_RATE_LIMIT: pass, BID_GLOBAL_RATE_LIMIT: pass }, ctx);
  expect((await bid({ question: "How do you stop reward hacking on long coding tasks?", usd: 20, market: "rl-evals" })).status).toBe(201);
  expect((await bid({ question: "short", usd: 20, market: "rl-evals" })).status).toBe(400);
  await Promise.all(pending);
  expect(sent).toEqual([["agent.bid", "chatgpt-user"]]);
});
