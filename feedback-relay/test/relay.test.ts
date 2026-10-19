import { createExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { WINDOWS } from "../src/quota";
import { LIMITS } from "../src/report";
import { mockGitHub } from "./github";
import { resetQuota } from "./quota-reset";

const fetchWorker = ((input: RequestInfo | URL, init?: RequestInit) =>
  exports.default.fetch(input, init)) as typeof fetch;

// FEEDBACK_QUOTA is one shared, durable counter, so a test that files
// issues would otherwise spend the window every later test relies on.
beforeEach(resetQuota);

afterEach(() => {
  vi.restoreAllMocks();
});

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    report_version: 1,
    title: "A title",
    email: "a@b.com",
    description: "A description",
    metadata: {
      submitted_at: "2026-01-01T00:00:00Z",
      source: "cli",
      lore_version: "0.1.0",
      platform: "Darwin 25.2.0",
      arch: "arm64",
      python_version: "3.12.4",
      install_id: "0".repeat(32),
      ...(overrides.metadata as Record<string, unknown> | undefined)
    },
    ...overrides
  };
}

// The Rate Limiting bindings in wrangler.jsonc are real under miniflare and
// nothing resets them between tests, so every request through `exports`
// without a cf-connecting-ip spends the same per-IP bucket of 5 a minute —
// the sixth such request in this file is a 429 whatever it carries. A test
// that needs to get past the limiters calls the handler itself with them
// unbound (the quota Durable Object stays, and beforeEach empties it). It is
// also the only way to hand the handler a Content-Length header that
// disagrees with the body: workerd computes its own for a request it sends.
function unlimited(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    FEEDBACK_RATE_LIMIT: undefined as unknown as RateLimit,
    GLOBAL_RATE_LIMIT: undefined as unknown as RateLimit,
    EVENTS_RATE_LIMIT: undefined as unknown as RateLimit,
    ...overrides
  };
}

function direct(body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request("https://relay.test/report", { method: "POST", headers, body });
  return worker.fetch(request, unlimited(), createExecutionContext());
}

const encoder = new TextEncoder();

/** A valid report's JSON, padded with trailing whitespace to exactly `bytes` bytes. */
function paddedTo(bytes: number): string {
  const json = JSON.stringify(validBody());
  return json + " ".repeat(bytes - encoder.encode(json).length);
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetchWorker("https://relay.test/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("routing", () => {
  it("404s an unknown path", async () => {
    const response = await fetchWorker("https://relay.test/nope");
    expect(response.status).toBe(404);
  });

  it("405s a non-POST /report, with an Allow header", async () => {
    const response = await fetchWorker("https://relay.test/report");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

describe("POST /report", () => {
  it("returns 201 and the created issue on a valid report", async () => {
    mockGitHub({ kind: "created", number: 7 });
    const response = await post(validBody());
    expect(response.status).toBe(201);
    const body: Record<string, unknown> = await response.json();
    expect(body).toMatchObject({
      ok: true,
      issue_number: 7,
      issue_url: "https://github.com/dipakkrishnan/lore-mcp/issues/7"
    });
  });

  it("415s a request with the wrong Content-Type", async () => {
    const response = await post(validBody(), { "Content-Type": "text/plain" });
    expect(response.status).toBe(415);
  });

  it("400s invalid JSON", async () => {
    const response = await post("not json");
    expect(response.status).toBe(400);
  });

  it("400s a report that fails validation, with the relay's own message", async () => {
    const response = await post(validBody({ title: "" }));
    expect(response.status).toBe(400);
    const body: { error: string } = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("413s a body past the cap, before any field validation", async () => {
    const response = await post(validBody({ description: "x".repeat(200_000) }));
    expect(response.status).toBe(413);
  });

  it("413s an oversize body of multi-byte text too — the cap counts bytes", async () => {
    // 50,000 four-byte code points is 200 KB on the wire but only 50,000
    // "characters", so a cap read as a character count would let it through.
    const response = await post(validBody({ description: "🚀".repeat(50_000) }));
    expect(response.status).toBe(413);
  });

  it("files a report whose every field is at its limit in four-byte characters", async () => {
    // The case that used to fail both ways round: ensure_ascii inflated it
    // past the old body cap, and UTF-16 counting made 20,000 emoji look
    // like 40,000 characters. A client-valid report must never be refused.
    mockGitHub({ kind: "created", number: 11 });
    const response = await post(
      validBody({ title: "🚀".repeat(200), description: "🚀".repeat(20_000) })
    );
    expect(response.status).toBe(201);
  });

  it("502s when GitHub rejects the issue", async () => {
    mockGitHub({ kind: "validation" });
    const response = await post(validBody());
    expect(response.status).toBe(502);
  });

  it("never exposes the GitHub token in any response body or header", async () => {
    mockGitHub({ kind: "unauthorized" });
    // Through `exports` this request was the sixth to reach the limiter and
    // came back a 429, so GitHub was never asked and the test proved nothing.
    const response = await direct(JSON.stringify(validBody()), { "Content-Type": "application/json" });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("test-token");
    for (const [, value] of response.headers) {
      expect(value).not.toContain("test-token");
    }
  });

  it("sets no CORS header — only Python callers hit this endpoint, never a browser", async () => {
    mockGitHub({ kind: "created" });
    // A 429 has no CORS header either; the one that matters is on a success.
    const response = await direct(JSON.stringify(validBody()), { "Content-Type": "application/json" });
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("429s a refused request, with Retry-After and no detail", async () => {
    // The 429 branch had no end-to-end test before. This drives the relay
    // until *some* layer refuses and checks the response the caller gets;
    // which layer gets there first is not this test's business, because the
    // limiter counters are shared across this file. That the aggregate cap
    // is the Durable Object's, and holds however many addresses a caller
    // uses, is asserted in test/limit.test.ts.
    mockGitHub({ kind: "created" });
    const minute = WINDOWS.find((window) => window.span === "minute");
    expect(minute).toBeDefined();
    let refused: Response | undefined;
    for (let i = 0; i <= minute!.limit && refused === undefined; i++) {
      const response = await post(validBody(), { "cf-connecting-ip": `10.1.0.${String(i)}` });
      if (response.status !== 201) refused = response;
    }
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("retry-after")).toBe("60");
    const body: { error: string } = await refused!.json();
    expect(body.error).toBe("too many requests");
  });
});

describe("GET /", () => {
  it("says what the relay is, as plain text", async () => {
    const response = await fetchWorker("https://relay.test/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(await response.text()).toContain("dipakkrishnan/lore-mcp");
  });
});

describe("POST /report, past the rate limiters", () => {
  const json = { "Content-Type": "application/json" };

  it("415s a body sent with no Content-Type at all", async () => {
    const request = new Request("https://relay.test/report", {
      method: "POST",
      body: encoder.encode(JSON.stringify(validBody()))
    });
    expect(request.headers.get("content-type")).toBeNull();
    const response = await worker.fetch(request, unlimited(), createExecutionContext());
    expect(response.status).toBe(415);
  });

  it("reads the Content-Type without regard to case or a charset", async () => {
    mockGitHub({ kind: "created" });
    const response = await direct(JSON.stringify(validBody()), {
      "Content-Type": "Application/JSON; charset=utf-8"
    });
    expect(response.status).toBe(201);
  });

  it("413s an oversize body that declares no length, counting the bytes it read", async () => {
    const github = mockGitHub({ kind: "created" });
    const response = await direct(paddedTo(LIMITS.bodyBytes + 1), json);
    expect(response.status).toBe(413);
    const body: { error: string } = await response.json();
    expect(body.error).toBe("request body too large");
    expect(github.requests).toHaveLength(0);
  });

  it("413s an oversize body whose Content-Length says it is small", async () => {
    const github = mockGitHub({ kind: "created" });
    const response = await direct(paddedTo(LIMITS.bodyBytes + 1), { ...json, "Content-Length": "10" });
    expect(response.status).toBe(413);
    expect(github.requests).toHaveLength(0);
  });

  it("counts that read in bytes, so multi-byte text under the cap in characters is still refused", async () => {
    // A quarter of the cap in four-byte characters is the cap in bytes, plus
    // the JSON around it: well under in characters, over in bytes.
    const body = JSON.stringify(validBody({ description: "🚀".repeat(LIMITS.bodyBytes / 4) }));
    expect(body.length).toBeLessThan(LIMITS.bodyBytes);
    const response = await direct(body, json);
    expect(response.status).toBe(413);
  });

  it("files a body of exactly the cap, whether or not it declares its length", async () => {
    const body = paddedTo(LIMITS.bodyBytes);
    mockGitHub({ kind: "created" });
    expect((await direct(body, json)).status).toBe(201);
    vi.restoreAllMocks();
    mockGitHub({ kind: "created" });
    const declared = await direct(body, { ...json, "Content-Length": String(LIMITS.bodyBytes) });
    expect(declared.status).toBe(201);
  });

  it("413s a declared length one byte past the cap before reading anything", async () => {
    const github = mockGitHub({ kind: "created" });
    const response = await direct(JSON.stringify(validBody()), {
      ...json,
      "Content-Length": String(LIMITS.bodyBytes + 1)
    });
    expect(response.status).toBe(413);
    expect(github.requests).toHaveLength(0);
  });

  it("400s invalid JSON with the relay's own sentence", async () => {
    const response = await direct("{not json", json);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "the request body is not valid JSON" });
  });

  it("502s an unexpected failure with the same fixed sentence and none of its detail", async () => {
    // GitHub says 201 but the body can't be read: the one way today for
    // something other than a ReportError to reach the handler's catch.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>secret upstream page</html>", { status: 201 })
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await direct(JSON.stringify(validBody()), json);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe(JSON.stringify({ error: "could not file the issue" }));
    expect(logged).toHaveBeenCalledWith("unexpected error filing feedback", expect.any(Error));
  });
});
