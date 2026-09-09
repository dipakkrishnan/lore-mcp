import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOWS } from "../src/quota";
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

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetchWorker("https://relay.test/report", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("routing", () => {
  it("serves a plain-text description at /", async () => {
    const response = await fetchWorker("https://relay.test/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

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
    const response = await post(validBody());
    const text = await response.text();
    expect(text).not.toContain("test-token");
    for (const [, value] of response.headers) {
      expect(value).not.toContain("test-token");
    }
  });

  it("sets no CORS header — only Python callers hit this endpoint, never a browser", async () => {
    mockGitHub({ kind: "created" });
    const response = await post(validBody());
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
