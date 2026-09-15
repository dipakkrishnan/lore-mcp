import { createIssue } from "./issue.js";
import { LIMITS as LISTING_LIMITS, NODE_RE, apply, parseListing, status } from "./listing.js";
import { allow } from "./limit.js";
import { LIMITS, ReportError, parseReport } from "./report.js";

// Re-exported from the entry module because that is where the runtime looks
// for a Durable Object class named in wrangler.jsonc.
export { FeedbackQuota } from "./quota.js";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function errorResponse(status: number, message: string, headers: HeadersInit = {}): Response {
  return json({ error: message }, status, headers);
}

/** The marketplace routes (APP-119): GET asks whether a node is listed,
 * pending, or neither; POST asks to list or delist it, which opens a pull
 * request on the registry repo. Same limiter as /report: both spend the
 * relay's GitHub tokens. */
async function listing(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return errorResponse(405, "method not allowed", { Allow: "GET, POST" });
  }
  if (!(await allow(env, request))) {
    return errorResponse(429, "too many requests", { "Retry-After": "60" });
  }
  try {
    if (request.method === "GET") {
      const node = url.searchParams.get("node") ?? "";
      if (!NODE_RE.test(node)) return errorResponse(400, "node must be an https address ending in /mcp");
      return json({ ok: true, ...(await status(env, node)) });
    }
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return errorResponse(415, "Content-Type must be application/json");
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > LISTING_LIMITS.bodyBytes) {
      return errorResponse(413, "request body too large");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return errorResponse(400, "the request body is not valid JSON");
    }
    const { created, ...outcome } = await apply(env, parseListing(parsed));
    return json(outcome, created ? 201 : 200);
  } catch (error) {
    if (error instanceof ReportError) {
      return errorResponse(error.status, error.message);
    }
    console.error("unexpected error handling a listing", error);
    return errorResponse(502, "could not update the marketplace");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "Lore feedback relay. Files owner-submitted reports as GitHub issues " +
          "on dipakkrishnan/lore-mcp, and opens marketplace listings as pull " +
          "requests on dipakkrishnan/lore-marketplace.\n",
        { headers: { "Content-Type": "text/plain" } }
      );
    }

    if (url.pathname === "/listing") {
      return listing(request, env, url);
    }

    if (url.pathname !== "/report") {
      return errorResponse(404, "not found");
    }

    if (request.method !== "POST") {
      return errorResponse(405, "method not allowed", { Allow: "POST" });
    }

    // No CORS headers, deliberately: both callers (lore/feedback.py, over
    // urllib) POST from a Python process, never a browser, so omitting
    // Access-Control-Allow-Origin means no web page can drive this endpoint
    // from a visitor's browser. Do not "fix" this by adding one.

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return errorResponse(415, "Content-Type must be application/json");
    }

    // Checked twice: Content-Length can be absent (chunked) or lie, so the
    // header is only the cheap early rejection — the real cap is enforced
    // again below against the bytes actually read.
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > LIMITS.bodyBytes) {
      return errorResponse(413, "request body too large");
    }

    if (!(await allow(env, request))) {
      return errorResponse(429, "too many requests", { "Retry-After": "60" });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) {
      return errorResponse(413, "request body too large");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return errorResponse(400, "the request body is not valid JSON");
    }

    try {
      const report = parseReport(parsed);
      const issue = await createIssue(env, report);
      return json(
        { ok: true, issue_url: issue.html_url, issue_number: issue.number },
        201
      );
    } catch (error) {
      if (error instanceof ReportError) {
        return errorResponse(error.status, error.message);
      }
      console.error("unexpected error filing feedback", error);
      return errorResponse(502, "could not file the issue");
    }
  }
};
