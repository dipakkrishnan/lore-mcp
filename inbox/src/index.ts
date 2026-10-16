import type { z } from "zod";
import { fail, json, respond } from "./http.js";
import { LIMITS, NewAgent, NewOwner, Received } from "./limits.js";
import { serve } from "./mcp.js";
import { Token, randomHex } from "./token.js";

export { Inbox } from "./inbox.js";

const OWNER_BODY_BYTES = 65_536;
const MCP_BODY_BYTES = 5_242_880;

class Api {
  constructor(
    readonly request: Request,
    readonly env: Env
  ) {}

  get url(): URL {
    return new URL(this.request.url);
  }

  inbox(owner: string) {
    return this.env.INBOX.get(this.env.INBOX.idFromName(owner));
  }

  /** The request body checked against `schema`, or the response refusing it. */
  async body<T extends z.ZodType>(schema: T, limit = OWNER_BODY_BYTES): Promise<z.infer<T> | Response> {
    const raw = await this.request.text();
    if (new TextEncoder().encode(raw).length > limit) return respond(fail(413, "request body too large"));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return respond(fail(400, "the request body is not valid JSON"));
    }
    const result = schema.safeParse(parsed);
    return result.success ? result.data : respond(fail(400, result.error.issues.map((issue) => issue.message).join("; ")));
  }

  async register(): Promise<Response> {
    const ip = this.request.headers.get("cf-connecting-ip") ?? "unknown";
    if (this.env.OWNERS_RATE_LIMIT && !(await this.env.OWNERS_RATE_LIMIT.limit({ key: ip })).success) {
      return json({ error: "too many requests" }, 429, { "Retry-After": "60" });
    }
    const body = await this.body(NewOwner);
    if (body instanceof Response) return body;
    const token = Token.mint("owner", randomHex(16));
    if (!(await this.inbox(token.owner).register(token.owner, body.public_key, token.secret))) return respond(fail(409, "owner already exists"));
    return json({ owner: token.owner, token: String(token) }, 201);
  }

  async owner(path: string): Promise<Response> {
    const token = Token.fromRequest(this.request, "owner");
    if (!token) return respond(fail(401, "this token is not valid"));
    const inbox = this.inbox(token.owner);
    const method = this.request.method;
    const agent = /^\/agents\/([0-9a-f]{16})(\/key)?$/.exec(path);
    if (path === "" && method === "GET") return respond(await inbox.summary(token.secret));
    if (path === "" && method === "DELETE") return respond(await inbox.erase(token.secret));
    if (path === "/agents" && method === "POST") {
      const body = await this.body(NewAgent);
      if (body instanceof Response) return body;
      const added = await inbox.addAgent(token.secret, body.name, body.app);
      return respond("token" in added ? { ...added, mcp_url: `${this.url.origin}/mcp` } : added, 201);
    }
    if (agent && agent[2] && method === "POST") return respond(await inbox.rotate(token.secret, agent[1]));
    if (agent && !agent[2] && method === "DELETE") return respond(await inbox.revoke(token.secret, agent[1]));
    if (path === "/items" && method === "GET") {
      const limit = Number(this.url.searchParams.get("limit") ?? 100);
      if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.list) return respond(fail(400, `limit must be 1–${LIMITS.list}`));
      return respond(await inbox.items(token.secret, this.url.searchParams.get("agent"), limit));
    }
    if (path === "/items/received" && method === "POST") {
      const body = await this.body(Received);
      if (body instanceof Response) return body;
      return respond(await inbox.received(token.secret, body.ids));
    }
    return respond(fail(404, "not found"));
  }

  async mcp(): Promise<Response> {
    const token = Token.fromRequest(this.request, "agent");
    const inbox = token && this.inbox(token.owner);
    if (!token || !inbox || !(await inbox.knows(token.secret))) {
      return json({ error: "a valid Lore agent token is required" }, 401, {
        "WWW-Authenticate": `Bearer resource_metadata="${this.url.origin}/.well-known/oauth-protected-resource"`
      });
    }
    if (this.request.method !== "POST") return json({ error: "method not allowed" }, 405, { Allow: "POST" });
    const raw = await this.request.arrayBuffer();
    if (raw.byteLength > MCP_BODY_BYTES) return respond(fail(413, "request body too large"));
    return serve(new Request(this.request, { body: raw }), inbox, token.secret);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const api = new Api(request, env);
    const path = api.url.pathname;
    if (path === "/mcp") return api.mcp();
    if (path === "/owners" && request.method === "POST") return api.register();
    if (path === "/owners/me" || path.startsWith("/owners/me/")) return api.owner(path.slice("/owners/me".length));
    if (path === "/") {
      return new Response("Lore inbox. Holds what an owner's agents save, sealed, until the owner's Mac collects it.\n", {
        headers: { "Content-Type": "text/plain" }
      });
    }
    return respond(fail(404, "not found"));
  }
};
