import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import contract from "../../contracts/usage_events.json";
import { MAX_EVENTS, forward, parseBatch } from "../src/events";
import worker from "../src/index";

const fetchWorker = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;
const AT = "2026-10-09T12:00:00Z";
const batch = (events: unknown[], overrides: Record<string, unknown> = {}) => ({ install_id: "a".repeat(32), version: "0.1.13", events, ...overrides });

afterEach(() => vi.restoreAllMocks());

describe("usage events", () => {
  it("keeps only listed events with a listed value", () => {
    const parsed = parseBatch(
      batch([
        { name: "store.opened", props: {}, at: AT },
        { name: "source.connected", props: { connector: "obsidian" }, at: AT },
        { name: "source.connected", props: { connector: "/Users/me/vault" }, at: AT },
        { name: "memory.saved", props: { title: "My secret note" }, at: AT },
        { name: "keystroke", props: {}, at: AT },
        { name: "sale.seen", props: { via: "card", amount: "12" }, at: AT }
      ])
    );
    expect(parsed?.events).toEqual([
      { name: "store.opened", props: {}, at: AT },
      { name: "source.connected", props: { connector: "obsidian" }, at: AT }
    ]);
  });

  it("refuses an envelope that names someone or carries too much", () => {
    expect(parseBatch(batch([], { install_id: "me@example.com" }))).toBeNull();
    expect(parseBatch(batch([], { version: "x".repeat(40) }))).toBeNull();
    expect(parseBatch(batch(Array(MAX_EVENTS + 1).fill({ name: "store.opened", props: {}, at: AT })))).toBeNull();
  });

  it("knows every event in the shared contract", () => {
    for (const [name, prop] of Object.entries(contract.events)) {
      const props = prop ? { [prop.prop]: prop.values[0] } : {};
      expect(parseBatch(batch([{ name, props, at: AT }]))?.events).toHaveLength(1);
    }
  });

  it("passes events to PostHog as an install id with no person profile", async () => {
    const sent = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await forward({ ...env, POSTHOG_KEY: "phc_test" }, parseBatch(batch([{ name: "sale.seen", props: { via: "agent" }, at: AT }]))!);
    const [url, init] = sent.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/batch/");
    expect(JSON.parse(init?.body as string)).toEqual({
      api_key: "phc_test",
      batch: [{ event: "sale.seen", distinct_id: "a".repeat(32), timestamp: AT, properties: { via: "agent", app_version: "0.1.13", $process_person_profile: false, $ip: null } }]
    });
  });

  it("keeps nothing without a PostHog key", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    await forward({ ...env, POSTHOG_KEY: "" }, parseBatch(batch([{ name: "store.opened", props: {}, at: AT }]))!);
    expect(sent).not.toHaveBeenCalled();
  });

  it("answers the sender at once and says how many it kept", async () => {
    // CI writes a POSTHOG_KEY into .dev.vars, so without this the kept event
    // would be sent to the real PostHog.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const response = await fetchWorker("https://relay.test/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch([{ name: "app.opened", props: {}, at: AT }, { name: "nope", props: {}, at: AT }]))
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });
    const bad = await fetchWorker("https://relay.test/events", { method: "POST", body: "{}" });
    expect(bad.status).toBe(400);
  });
});

describe("parseBatch, shapes that are not objects", () => {
  it("refuses an envelope that is not an object", () => {
    for (const value of [null, undefined, "batch", 7, true]) expect(parseBatch(value)).toBeNull();
  });

  it("drops an event that is not an object and keeps the rest", () => {
    const kept = { name: "store.opened", props: {}, at: AT };
    expect(parseBatch(batch([null, undefined, "store.opened", 7, kept]))?.events).toEqual([kept]);
  });

  it("keeps an event that takes no property whether its props are empty, null or missing", () => {
    const parsed = parseBatch(
      batch([
        { name: "store.opened", props: null, at: AT },
        { name: "store.opened", at: AT }
      ])
    );
    expect(parsed?.events).toEqual([
      { name: "store.opened", props: {}, at: AT },
      { name: "store.opened", props: {}, at: AT }
    ]);
  });

  it("drops an event that needs its one property when props are null", () => {
    expect(parseBatch(batch([{ name: "source.connected", props: null, at: AT }]))?.events).toEqual([]);
  });
});

describe("POST /events", () => {
  const EVENTS_BYTES = 8_192;
  const encoder = new TextEncoder();

  function limiter(success: boolean) {
    return { limit: vi.fn().mockResolvedValue({ success }) };
  }

  // The EVENTS_RATE_LIMIT binding is real under miniflare and never reset
  // (see test/relay.test.ts), so these call the handler with their own.
  function call(body: string, overrides: Partial<Env> = {}, headers: Record<string, string> = {}) {
    const request = new Request("https://relay.test/events", { method: "POST", headers, body });
    const ctx = createExecutionContext();
    const settings = { ...env, EVENTS_RATE_LIMIT: undefined as unknown as RateLimit, POSTHOG_KEY: "", ...overrides };
    return { request, ctx, response: worker.fetch(request, settings, ctx) };
  }

  /** A one-event batch padded with trailing whitespace to exactly `bytes` bytes. */
  function paddedTo(bytes: number): string {
    const json = JSON.stringify(batch([{ name: "store.opened", props: {}, at: AT }]));
    return json + " ".repeat(bytes - encoder.encode(json).length);
  }

  it("405s anything but POST, with an Allow header", async () => {
    for (const method of ["GET", "PUT"]) {
      const response = await fetchWorker("https://relay.test/events", { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });

  it("400s invalid JSON and a body that is not a batch, each with its own sentence", async () => {
    const invalid = await call("{not json").response;
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "the request body is not valid JSON" });
    const wrong = await call(JSON.stringify({ events: [] })).response;
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "not a usage batch" });
  });

  it("takes a body of exactly 8 KB and 413s one byte more", async () => {
    const atCap = await call(paddedTo(EVENTS_BYTES)).response;
    expect(atCap.status).toBe(202);
    const over = await call(paddedTo(EVENTS_BYTES + 1)).response;
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "request body too large" });
  });

  it("counts that size in bytes, not characters", async () => {
    // parseBatch ignores fields it doesn't know, so the padding is legal.
    const body = JSON.stringify({ ...batch([]), pad: "é".repeat(EVENTS_BYTES / 2) });
    expect(body.length).toBeLessThan(EVENTS_BYTES);
    expect((await call(body).response).status).toBe(413);
  });

  it("429s a refused sender before reading what they sent", async () => {
    const refusing = limiter(false);
    const { request, response } = call(paddedTo(200), { EVENTS_RATE_LIMIT: refusing as unknown as RateLimit }, {
      "cf-connecting-ip": "203.0.113.9"
    });
    const refused = await response;
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(await refused.json()).toEqual({ error: "too many requests" });
    expect(refusing.limit).toHaveBeenCalledWith({ key: "203.0.113.9" });
    expect(request.bodyUsed).toBe(false);
  });

  it("keys the limiter on one shared name when the caller's address is missing, and lets an allowed sender through", async () => {
    const allowing = limiter(true);
    const response = await call(paddedTo(200), { EVENTS_RATE_LIMIT: allowing as unknown as RateLimit }).response;
    expect(response.status).toBe(202);
    expect(allowing.limit).toHaveBeenCalledWith({ key: "unknown" });
  });

  it("answers before PostHog does", async () => {
    let answer: (response: Response) => void = () => undefined;
    const sent = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve))
    );
    const { ctx, response } = call(paddedTo(200), { POSTHOG_KEY: "phc_test" });
    // PostHog hasn't answered yet; if the handler waited on it, this would hang.
    expect((await response).status).toBe(202);
    expect(sent).toHaveBeenCalledOnce();
    answer(new Response("{}"));
    await waitOnExecutionContext(ctx);
  });

  it("still answers 202 when PostHog can't be reached, and the failure ends quietly", async () => {
    const sent = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("simulated PostHog outage"));
    const { ctx, response } = call(paddedTo(200), { POSTHOG_KEY: "phc_test" });
    const answered = await response;
    expect(answered.status).toBe(202);
    expect(await answered.json()).toEqual({ accepted: 1 });
    // waitOnExecutionContext rethrows a rejected waitUntil promise, so this
    // fails if the handler stops catching the forward.
    await waitOnExecutionContext(ctx);
    expect(sent).toHaveBeenCalledWith("https://us.i.posthog.com/batch/", expect.anything());
  });
});
