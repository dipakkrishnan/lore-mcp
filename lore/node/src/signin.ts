import {
  AuthorizationError,
  CimdFetchError,
  GrantType,
  OAuthAuthorizationServer,
  OAuthError,
  OAuthResourceServer,
  type OAuthResourceContext,
  insufficientScope
} from "@cloudflare/workers-oauth-provider";
import { Inbox, ensureInboxSchema } from "./inbox.js";
import { hex } from "./seal.js";
import { escape, plainPage } from "./storefront.js";

/**
 * XC-068: the owner's agents sign in to `/agent` with MCP OAuth instead of a key in the address. Nobody logs in
 * here: the page names the app asking and shows a short code, and the owner allows it in Lore on their Mac, which
 * makes the agent's row as a pasted key does and binds the grant to it.
 */

export const SCOPE = "save";
/** All the agent side reads: an owner's own node gives it its bindings, a hosted store its own tables (XC-088). */
export type AgentEnv = { LORE_DB: D1Database; OAUTH_KV: KVNamespace };
type Props = { agent: string; hash: string };
type Asked = { state: "pending" | "allowed" | "denied"; agent: string | null };

const DAY = 86_400;
const WAIT_MS = 600_000;
const AT_ONCE = 3;
const HOURLY = 20;
const CODE = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const iso = (time: number) => new Date(time).toISOString();

const POLL = `const handle=document.body.dataset.handle,status=document.querySelector("[data-status]");
async function poll(){let answer={state:"pending"};try{const body=new FormData();body.set("handle",handle);answer=await (await fetch("/authorize/wait",{method:"POST",body})).json()}catch{}
if(answer.redirect){status.textContent=answer.state==="allowed"?"Allowed. Taking you back…":"Not allowed. Taking you back…";location.replace(answer.redirect);return}
if(answer.state==="expired"){status.textContent="This sign-in expired. Start again from the app.";status.className="";return}
setTimeout(poll,2000)}
setTimeout(poll,2000)`;

async function digest(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function pairing(): string {
  return [...crypto.getRandomValues(new Uint8Array(4))].map((byte) => CODE[byte % CODE.length]).join("");
}

function page(status: number, title: string, body: string, headers: HeadersInit = {}, script = ""): Response {
  const sent = new Headers(headers);
  sent.set("content-type", "text/html; charset=utf-8");
  sent.set("cache-control", "no-store");
  sent.set("referrer-policy", "no-referrer");
  return new Response(plainPage(title, body, script), { status, headers: sent });
}

function answer(body: object, headers: HeadersInit = {}): Response {
  const sent = new Headers(headers);
  sent.delete("location");
  sent.set("cache-control", "no-store");
  return Response.json(body, { headers: sent });
}

export class SignIn {
  readonly server: OAuthAuthorizationServer<AgentEnv>;
  readonly resource: OAuthResourceServer<AgentEnv, Props>;

  /** @param serve answers an agent's MCP request once its inbox is known */
  constructor(
    readonly origin: string,
    serve: (request: Request, inbox: Inbox) => Promise<Response>
  ) {
    const resource = `${origin}/agent`;
    this.server = new OAuthAuthorizationServer<AgentEnv>({
      issuer: origin,
      resources: [resource],
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [SCOPE],
      // A grant lives while its agent keeps saving, and lapses after two idle months.
      refreshTokenTTL: 60 * DAY,
      refreshTokenIdleTTL: 60 * DAY,
      tokenExchangeCallback: async ({ grantType, props, grantId, userId, env }) => {
        const { agent, hash } = props as Props;
        if (grantType !== GrantType.REFRESH_TOKEN || (await Inbox.bound(env.LORE_DB, agent, hash))) return;
        await this.server.getOAuthApi(env).revokeGrant(grantId, userId);
        throw new OAuthError("invalid_grant", { description: "this agent was disconnected in Lore; add Lore again to sign in" });
      }
    });
    this.resource = new OAuthResourceServer<AgentEnv, Props>({
      resourceMetadata: { resource, authorization_servers: [origin], resource_name: "Lore" },
      requiredScopes: [SCOPE],
      validateToken: (env) => (resource, token) => this.server.validateToken<Props>(resource, token, env),
      handler: {
        fetch: async (request, env, ctx: OAuthResourceContext<Props>) => {
          if (!ctx.auth.scope.includes(SCOPE)) return insufficientScope(ctx.auth, [SCOPE]);
          const inbox = await Inbox.bound(env.LORE_DB, ctx.props.agent, ctx.props.hash);
          if (inbox) return serve(request, inbox);
          await this.disconnect(env, ctx.props.agent);
          return Response.json(
            { error: "this agent was disconnected in Lore; add Lore again to sign in" },
            { status: 401, headers: { "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${this.metadata}"` } }
          );
        }
      }
    });
  }

  get metadata(): string {
    return `${this.origin}/.well-known/oauth-protected-resource/agent`;
  }

  /** Paths the provider itself answers: its metadata, registration and tokens. */
  static owns(pathname: string): boolean {
    return /^\/(\.well-known\/(oauth-authorization-server|openid-configuration)|oauth\/(token|register))(\/|$)/.test(pathname);
  }

  /** An agent the owner disconnected keeps no grant: its refresh tokens go with its access. */
  private async disconnect(env: AgentEnv, agent: string): Promise<void> {
    const api = this.server.getOAuthApi(env);
    const { items } = await api.listUserGrants(agent);
    await Promise.all(items.map((grant) => api.revokeGrant(grant.id, agent)));
  }

  /** At most a few sign-ins wait on the owner at once, and only so many start in an hour. */
  private async crowded(db: D1Database, now: number): Promise<boolean> {
    await ensureInboxSchema(db);
    await db.prepare("DELETE FROM sign_ins WHERE expires_at <= ?").bind(iso(now - DAY * 1000)).run();
    const row = await db
      .prepare("SELECT count(*) AS started, sum(state = 'pending' AND expires_at > ?1) AS waiting FROM sign_ins WHERE created_at > ?2")
      .bind(iso(now), iso(now - 3_600_000))
      .first<{ started: number; waiting: number | null }>();
    return (row?.waiting ?? 0) >= AT_ONCE || (row?.started ?? 0) >= HOURLY;
  }

  /** The page an agent's sign-in opens: who is asking, the code the Mac shows too, and a wait for the owner. */
  async authorize(request: Request, env: AgentEnv): Promise<Response> {
    const api = this.server.getOAuthApi(env);
    try {
      const asked = await api.parseAuthRequest(request);
      const details = await api.describeConsent(asked);
      const now = Date.now();
      if (await this.crowded(env.LORE_DB, now)) {
        return page(429, "Try again soon", "<h1>Too many sign-ins at once</h1><p class=\"lede\">Wait a few minutes, then start again from the app.</p>");
      }
      const consent = await api.beginConsent(asked);
      const client = [...details.clientName.trim()].slice(0, 60).join("");
      const code = pairing();
      await env.LORE_DB.prepare("INSERT INTO sign_ins (id, code, client, state, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?)")
        .bind(await digest(consent.handle), code, client, iso(now), iso(now + WAIT_MS))
        .run();
      const name = escape(client);
      const local = details.redirectIsLoopback ? "<p>It signs in an app on this computer. Allow it only if you just added Lore to it.</p>" : "";
      const body =
        `<h1>${name} wants to save to your Lore</h1><p class="lede">Approve on your Mac. Lore shows this code there too; allow it only if they match.</p>` +
        `<div class="pair" aria-label="Code">${escape(code)}</div>${local}` +
        `<p class="wait" data-status>Waiting for you to allow it in Lore on your Mac…</p>` +
        `<p>After you allow it, you go back to ${escape(details.redirectHost)}. What it saves stays private on your Mac until you approve a piece.</p>`;
      const html = plainPage(`Connect ${client} to Lore`, body, POLL).replace("<body>", `<body data-handle="${escape(consent.handle)}">`);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      consent.headers.set("referrer-policy", "no-referrer");
      return new Response(html, { headers: consent.headers });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        return page(400, "Can't sign in", "<h1>This sign-in can't go through</h1><p class=\"lede\">Start again from the app you're connecting.</p>");
      }
      throw error;
    }
  }

  /** What the waiting page hears: still waiting, gone, or where to go now that the owner allowed or refused it. */
  async wait(request: Request, env: AgentEnv): Promise<Response> {
    const db = env.LORE_DB;
    const handle = (await request.formData().catch(() => null))?.get("handle");
    if (typeof handle !== "string") return answer({ state: "expired" });
    await ensureInboxSchema(db);
    const id = await digest(handle);
    const asked = await db.prepare("SELECT state, agent FROM sign_ins WHERE id = ? AND expires_at > ?").bind(id, iso(Date.now())).first<Asked>();
    if (!asked) return answer({ state: "expired" });
    if (asked.state === "pending") return answer({ state: "pending" });
    const api = this.server.getOAuthApi(env);
    try {
      if (asked.state === "denied") {
        const denied = await api.denyConsent(request, handle, { description: "The owner didn't allow it in Lore" });
        await db.prepare("DELETE FROM sign_ins WHERE id = ?").bind(id).run();
        return answer({ state: "denied", redirect: denied.redirectTo }, denied.headers);
      }
      const approved = await api.approveConsent(request, handle, { scope: [SCOPE] });
      // Once only: the row goes as the grant is made, so a second wait finds nothing to finish.
      const claimed = await db.prepare("DELETE FROM sign_ins WHERE id = ? AND state = 'allowed' RETURNING agent").bind(id).first<{ agent: string }>();
      const agent = claimed && (await db.prepare("SELECT token_hash FROM agents WHERE id = ? AND revoked_at IS NULL").bind(claimed.agent).first<{ token_hash: string }>());
      if (!claimed || !agent) return answer({ state: "expired" });
      const { redirectTo } = await api.completeAuthorization({
        request: approved.request,
        userId: claimed.agent,
        metadata: {},
        scope: [SCOPE],
        props: { agent: claimed.agent, hash: agent.token_hash } satisfies Props
      });
      return answer({ state: "allowed", redirect: redirectTo }, approved.headers);
    } catch (error) {
      if (error instanceof AuthorizationError) return answer({ state: "expired" });
      throw error;
    }
  }
}
