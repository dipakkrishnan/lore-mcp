// XC-066: a request the relay is going to refuse spends nothing shared. The body is read (capped)
// and checked first; only a report about to go to GitHub takes GLOBAL_RATE_LIMIT and then a slot in
// FEEDBACK_QUOTA. The per-IP limiter stays ahead of the read, since it costs only the sender.
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { QUOTA_NAME } from "../src/quota";
import { LIMITS } from "../src/report";
import { EVENTS_BODY_BYTES } from "../src/report-rules";
import { mockGitHub } from "./github";
import { resetQuota } from "./quota-reset";

beforeEach(resetQuota);
afterEach(() => {
  vi.restoreAllMocks();
});

/** A global limiter that counts its calls and allows `allowed` of them. */
function globalLimiter(allowed = Infinity) {
  let calls = 0;
  const limit = vi.fn(async () => ({ success: ++calls <= allowed }));
  return { limit, calls: () => calls };
}

function relayEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...env,
    FEEDBACK_RATE_LIMIT: undefined as unknown as RateLimit,
    GLOBAL_RATE_LIMIT: undefined as unknown as RateLimit,
    EVENTS_RATE_LIMIT: undefined as unknown as RateLimit,
    ...overrides
  };
}

/** What each quota window has used so far. */
async function windowsUsed(): Promise<number[]> {
  const stub = env.FEEDBACK_QUOTA.get(env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME));
  return runInDurableObject(stub, (_instance, state) =>
    state.storage.sql.exec<{ used: number }>("SELECT used FROM windows ORDER BY span").toArray().map((row) => row.used)
  );
}

/** A body sent in 1 KB chunks, pulled only when read, that counts what the relay took. */
function countingBody(bytes: number) {
  let pulled = 0;
  const chunk = new Uint8Array(1024).fill(0x20);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= bytes) return controller.close();
      const next = chunk.subarray(0, Math.min(chunk.length, bytes - pulled));
      pulled += next.length;
      controller.enqueue(next);
    }
  }, { highWaterMark: 0 });
  return { stream, pulled: () => pulled };
}

function validReport(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
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
      install_id: "0".repeat(32)
    },
    ...overrides
  });
}

function send(path: string, body: BodyInit, relay: Env, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request(`https://relay.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body
  });
  return worker.fetch(request, relay, createExecutionContext());
}

describe("POST /report checks a request before it spends shared limits", () => {
  it("refuses an oversize chunked body, invalid JSON and a refused report without spending anything", async () => {
    const global = globalLimiter();
    const relay = relayEnv({ GLOBAL_RATE_LIMIT: global as unknown as RateLimit });
    const oversize = countingBody(LIMITS.bodyBytes + 50_000);
    const cases: [BodyInit, number, string][] = [
      [oversize.stream, 413, "request body too large"],
      ["nope", 400, "the request body is not valid JSON"],
      [validReport({ title: "" }), 400, ""]
    ];
    for (const [body, status, error] of cases) {
      const response = await send("/report", body, relay);
      expect(response.status).toBe(status);
      const said: unknown = await response.json();
      if (error) expect(said).toMatchObject({ error });
    }
    expect(global.calls()).toBe(0);
    expect(await windowsUsed()).toEqual([]);
  });

  it("files a valid report after 60 invalid ones", async () => {
    mockGitHub({ kind: "created", number: 9 });
    const global = globalLimiter(60);
    const relay = relayEnv({ GLOBAL_RATE_LIMIT: global as unknown as RateLimit });
    for (let n = 0; n < 60; n++) expect((await send("/report", "nope", relay)).status).toBe(400);
    expect((await send("/report", validReport(), relay)).status).toBe(201);
  });

  it("takes exactly one global call and one slot in each window for a valid report", async () => {
    mockGitHub({ kind: "created" });
    const global = globalLimiter();
    const relay = relayEnv({ GLOBAL_RATE_LIMIT: global as unknown as RateLimit });
    expect((await send("/report", validReport(), relay)).status).toBe(201);
    expect(global.calls()).toBe(1);
    expect(await windowsUsed()).toEqual([1, 1]);
  });

  it("refuses a sender the per-IP limiter refuses before reading its body", async () => {
    const body = countingBody(1_000);
    const relay = relayEnv({ FEEDBACK_RATE_LIMIT: { limit: async () => ({ success: false }) } as unknown as RateLimit });
    expect((await send("/report", body.stream, relay)).status).toBe(429);
    expect(body.pulled()).toBe(0);
  });

  it("reads no more than one chunk past the cap, and nothing at all past a declared length over it", async () => {
    const body = countingBody(LIMITS.bodyBytes * 4);
    expect((await send("/report", body.stream, relayEnv())).status).toBe(413);
    expect(body.pulled()).toBeLessThanOrEqual(LIMITS.bodyBytes + 1024);
    const declared = countingBody(1_000);
    const refused = await send("/report", declared.stream, relayEnv(), { "Content-Length": String(LIMITS.bodyBytes + 1) });
    expect(refused.status).toBe(413);
    expect(declared.pulled()).toBe(0);
  });

  it("ignores a Content-Length that isn't a number, and holds the body to the cap as read", async () => {
    mockGitHub({ kind: "created" });
    expect((await send("/report", validReport(), relayEnv(), { "Content-Length": "abc" })).status).toBe(201);
    const body = countingBody(LIMITS.bodyBytes + 5_000);
    expect((await send("/report", body.stream, relayEnv(), { "Content-Length": "abc" })).status).toBe(413);
  });
});

describe("POST /events holds its body to the cap as it reads", () => {
  it("reads no more than one chunk past the cap, and nothing past a declared length over it", async () => {
    const body = countingBody(EVENTS_BODY_BYTES * 8);
    expect((await send("/events", body.stream, relayEnv())).status).toBe(413);
    expect(body.pulled()).toBeLessThanOrEqual(EVENTS_BODY_BYTES + 1024);
    const declared = countingBody(100);
    const refused = await send("/events", declared.stream, relayEnv(), { "Content-Length": String(EVENTS_BODY_BYTES + 1) });
    expect(refused.status).toBe(413);
    expect(declared.pulled()).toBe(0);
  });
});
