import { createIssue } from "./issue.js";
import { allow } from "./limit.js";
import { LIMITS, ReportError, parseReport } from "./report.js";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

function errorResponse(status: number, message: string, headers: HeadersInit = {}): Response {
  return json({ error: message }, status, headers);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "Lore feedback relay. Files owner-submitted reports as GitHub issues " +
          "on dipakkrishnan/lore-mcp.\n",
        { headers: { "Content-Type": "text/plain" } }
      );
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
