// Agent demand (XC-120): one cookieless count per agent-facing request, carrying only a coarse
// agent family from the User-Agent. The relay's SiteEvents entrypoint checks it against
// contracts/usage_events.json and passes it to PostHog under one fixed site id.
import contract from "../../contracts/usage_events.json" with { type: "json" };

// First match wins, so the specific agents come before the generic clients they build on.
const FAMILIES = [
  [/Claude-User/i, "claude-user"],
  [/ClaudeBot|Claude-SearchBot|anthropic-ai/i, "claudebot"],
  [/ChatGPT-User/i, "chatgpt-user"],
  [/OAI-SearchBot/i, "oai-searchbot"],
  [/GPTBot/i, "gptbot"],
  [/Perplexity-User/i, "perplexity-user"],
  [/PerplexityBot/i, "perplexitybot"],
  [/Grok|\bxAI\b/i, "grok"],
  [/Googlebot|Google-Extended|GoogleOther|Google-CloudVertexBot/i, "google"],
  [/bingbot/i, "bingbot"],
  [/^curl\//i, "curl"],
  [/python|aiohttp/i, "python"],
  [/^node\b|node-fetch|undici|axios/i, "node"],
  [/^Mozilla\/5\.0/, "browser"]
];

export function agentFamily(userAgent) {
  return FAMILIES.find(([pattern]) => pattern.test(userAgent ?? ""))?.[1] ?? "other";
}

/**
 * Count one request as `event` (a name in the contract's site_events), after the response. Only
 * two codes cross the binding, never the request, so no IP or header leaves this Worker.
 */
export function countDemand(event, request, env, ctx) {
  if (!env?.RELAY || !contract.site_events.names.includes(event)) return;
  const sent = Promise.resolve()
    .then(() => env.RELAY.count(event, agentFamily(request.headers.get("user-agent"))))
    .catch(() => undefined);
  ctx?.waitUntil(sent);
}
