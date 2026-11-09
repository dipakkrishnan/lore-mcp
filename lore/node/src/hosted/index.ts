import { DurableObject } from "cloudflare:workers";
import { agentRoute } from "../agent.js";
import { SqlKv } from "./kv.js";
import { Owner, type Refusal } from "./owner.js";
import { otherOf, storeOf } from "./routes.js";
import { SqlDatabase } from "./sql.js";

/**
 * XC-088: Lore's hosted stores, one Durable Object each at `<store>.yourlore.dev` (contracts/hosted-inbox.md). For
 * now a store is an inbox: the owner's agents save to it with the same `/agent` an owner's own node serves, and the
 * owner's Mac collects with signed requests. The library and the keys that open saves stay on the Mac, and nothing
 * here touches money.
 */

export type HostedEnv = {
  STORES: DurableObjectNamespace<HostedStore>;
  STORE_DOMAIN: string;
  CLAIMS: RateLimit;
  RELAY: Fetcher;
  CHECKOUT: Fetcher;
  SITE: Fetcher;
};

const BODY_BYTES = 1_048_576;

const refuse = ({ status, error }: Refusal) => Response.json({ error }, { status });

async function body(request: Request): Promise<ArrayBuffer | null> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  return bytes.byteLength > BODY_BYTES ? null : bytes;
}

export class HostedStore extends DurableObject<HostedEnv> {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const owner = new Owner(this.ctx.storage.sql);
    if (pathname === "/claim" || pathname === "/owner/sql") {
      if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
      const sent = await body(request);
      if (!sent) return refuse({ status: 413, error: "request body too large" });
      const refused = pathname === "/claim" ? await owner.claim(request, sent) : await owner.check(request, sent);
      if (refused) return refuse(refused);
      return pathname === "/claim" ? Response.json({ claimed: true }) : this.script(sent);
    }
    // A store nobody claimed answers nothing, and keeps nothing.
    if (!owner.claimed()) return refuse({ status: 404, error: "no store here" });
    const env = { LORE_DB: new SqlDatabase(this.ctx.storage).d1, OAUTH_KV: new SqlKv(this.ctx.storage.sql).namespace };
    const context = { waitUntil: (promise: Promise<unknown>) => this.ctx.waitUntil(promise), passThroughOnException() {}, props: {} };
    return (await agentRoute(request, env, context as ExecutionContext)) ?? refuse({ status: 404, error: "nothing here yet" });
  }

  /** The owner's statements, all or none, with each one's rows: what `wrangler d1 execute` gives an owner's own node. */
  private script(sent: ArrayBuffer): Response {
    let sql: unknown;
    try {
      sql = (JSON.parse(new TextDecoder().decode(sent)) as { sql?: unknown }).sql;
    } catch {
      sql = undefined;
    }
    if (typeof sql !== "string") return refuse({ status: 400, error: "send the statements as JSON: {\"sql\": \"...\"}" });
    try {
      return Response.json({ results: new SqlDatabase(this.ctx.storage).script(sql) });
    } catch (error) {
      return refuse({ status: 400, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    const url = new URL(request.url);
    const store = storeOf(url.hostname, env.STORE_DOMAIN);
    if (!store) {
      const other = otherOf(url.hostname, env.STORE_DOMAIN);
      return other ? env[other].fetch(request) : refuse({ status: 404, error: "no store here" });
    }
    // Signed requests and agents' sign-ins name the store by its https address.
    if (url.protocol !== "https:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === "/claim") {
      const { success } = await env.CLAIMS.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
      if (!success) return refuse({ status: 429, error: "too many new stores from here; try again in a minute" });
    }
    const response = await env.STORES.get(env.STORES.idFromName(store)).fetch(request);
    if (response.headers.has("cache-control")) return response;
    const uncached = new Response(response.body, response);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  }
};
