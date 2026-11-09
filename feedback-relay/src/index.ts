import { WorkerEntrypoint } from "cloudflare:workers";
import { forward, siteBatch } from "./events.js";
import { createIssue } from "./issue.js";
import { allow } from "./limit.js";
import { ReportError, parseReport } from "./report.js";
import {
  RATE_LIMITED,
  type Refusal,
  failure,
  parseJson,
  readEvents,
  refuseBody,
  refuseContentType,
  refuseDeclaredLength,
  refuseMethod
} from "./report-rules.js";

// Re-exported from the entry module because that is where the runtime looks
// for a Durable Object class named in wrangler.jsonc.
export { FeedbackQuota } from "./quota.js";

/**
 * yourlore.dev's agent-demand counts (XC-120). Reachable only through a service binding, so no
 * one else can add to the count, and it takes two codes rather than a request, so no visitor's
 * IP or headers ever reach the relay.
 */
export class SiteEvents extends WorkerEntrypoint<Env> {
  async count(name: string, agent: string): Promise<void> {
    const batch = siteBatch(name, agent);
    if (batch) await forward(this.env, batch);
  }
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

// The rules each refusal comes from are in report-rules.ts (XC-102), tested there in plain node.
function refuse({ status, error, headers }: Refusal): Response {
  return json({ error }, status, headers);
}

/** Usage events: checked against the list here, passed on after the response, never blocking the sender. */
async function events(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const wrongMethod = refuseMethod(request.method);
  if (wrongMethod) return refuse(wrongMethod);
  if (env.EVENTS_RATE_LIMIT) {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.EVENTS_RATE_LIMIT.limit({ key: ip })).success) return refuse(RATE_LIMITED);
  }
  const read = readEvents(await request.text());
  if ("status" in read) return refuse(read);
  ctx.waitUntil(forward(env, read.batch).catch(() => undefined));
  return json({ accepted: read.batch.events.length }, 202);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/events") return events(request, env, ctx);

    if (url.pathname === "/") {
      return new Response(
        "Lore feedback relay. Files owner-submitted reports as GitHub issues " +
          "on dipakkrishnan/lore-mcp.\n",
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    if (url.pathname !== "/report") {
      return refuse({ status: 404, error: "not found" });
    }

    const wrongMethod = refuseMethod(request.method);
    if (wrongMethod) return refuse(wrongMethod);

    // No CORS headers, deliberately: both callers (lore/feedback.py, over
    // urllib) POST from a Python process, never a browser, so omitting
    // Access-Control-Allow-Origin means no web page can drive this endpoint
    // from a visitor's browser. Do not "fix" this by adding one.

    const notJson = refuseContentType(request.headers.get("content-type"));
    if (notJson) return refuse(notJson);

    // Checked twice: Content-Length can be absent (chunked) or lie, so the
    // header is only the cheap early rejection — the real cap is enforced
    // again below against the bytes actually read.
    const declaredTooLarge = refuseDeclaredLength(request.headers.get("content-length"));
    if (declaredTooLarge) return refuse(declaredTooLarge);

    if (!(await allow(env, request))) return refuse(RATE_LIMITED);

    const raw = await request.text();
    const tooLarge = refuseBody(raw);
    if (tooLarge) return refuse(tooLarge);

    const parsed = parseJson(raw);
    if ("status" in parsed) return refuse(parsed);

    try {
      const report = parseReport(parsed.value);
      const issue = await createIssue(env, report);
      return json(
        { ok: true, issue_url: issue.html_url, issue_number: issue.number },
        201
      );
    } catch (error) {
      if (!(error instanceof ReportError)) console.error("unexpected error filing feedback", error);
      return refuse(failure(error));
    }
  }
};
