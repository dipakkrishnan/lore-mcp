import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockGitHub } from "./github";

const fetchWorker = ((input: RequestInfo | URL, init?: RequestInit) =>
  exports.default.fetch(input, init)) as typeof fetch;

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

  it("413s an oversize body", async () => {
    const response = await post(validBody({ description: "x".repeat(70_000) }));
    expect(response.status).toBe(413);
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
});
