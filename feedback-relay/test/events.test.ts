import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import contract from "../../contracts/usage_events.json";
import { MAX_EVENTS, forward, parseBatch } from "../src/events";

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
    await forward({ ...env, POSTHOG_KEY: undefined }, parseBatch(batch([{ name: "store.opened", props: {}, at: AT }]))!);
    expect(sent).not.toHaveBeenCalled();
  });

  it("answers the sender at once and says how many it kept", async () => {
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
