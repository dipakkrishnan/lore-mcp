import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allow } from "../src/limit";
import { QUOTA_NAME, WINDOWS } from "../src/quota";
import { resetQuota } from "./quota-reset";

function limiter(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

// The quota is durable by design, so each case starts from an empty window
// rather than inheriting whatever the previous one spent.
beforeEach(resetQuota);

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    // allow() never reads this; kept as the literal wrangler.jsonc default
    // so this fake satisfies Env's generated type without a cast.
    LORE_GITHUB_API: "https://api.github.com",
    LORE_FEEDBACK_GITHUB_TOKEN: "test-token",
    // Absent under `wrangler dev` and in most tests — see src/limit.ts.
    FEEDBACK_RATE_LIMIT: undefined as unknown as RateLimit,
    GLOBAL_RATE_LIMIT: undefined as unknown as RateLimit,
    FEEDBACK_QUOTA: undefined as unknown as Env["FEEDBACK_QUOTA"],
    ...overrides
  };
}

const report = () => new Request("https://relay.test/report");

describe("allow", () => {
  it("allows when no layer is present", async () => {
    await expect(allow(fakeEnv(), report())).resolves.toBe(true);
  });

  it("allows when both bindings succeed", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(true) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(true) as unknown as RateLimit
    });
    await expect(allow(env, report())).resolves.toBe(true);
  });

  it("denies when the per-IP limiter denies", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(false) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(true) as unknown as RateLimit
    });
    await expect(allow(env, report())).resolves.toBe(false);
  });

  it("denies when the per-location pre-filter denies", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(true) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(false) as unknown as RateLimit
    });
    await expect(allow(env, report())).resolves.toBe(false);
  });

  it("keys the per-IP limiter on cf-connecting-ip when present", async () => {
    const feedback = limiter(true);
    const env = fakeEnv({ FEEDBACK_RATE_LIMIT: feedback as unknown as RateLimit });
    await allow(
      env,
      new Request("https://relay.test/report", {
        headers: { "cf-connecting-ip": "1.2.3.4" }
      })
    );
    expect(feedback.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
  });

  it("falls back to a shared key when cf-connecting-ip is absent — merging every caller into one bucket, not a bypass", async () => {
    const feedback = limiter(true);
    const env = fakeEnv({ FEEDBACK_RATE_LIMIT: feedback as unknown as RateLimit });
    await allow(env, report());
    expect(feedback.limit).toHaveBeenCalledWith({ key: "unknown" });
  });

  it("keys the pre-filter on a constant, not the caller", async () => {
    const global = limiter(true);
    const env = fakeEnv({ GLOBAL_RATE_LIMIT: global as unknown as RateLimit });
    await allow(env, report());
    expect(global.limit).toHaveBeenCalledWith({ key: "global" });
  });

  it("denies past the quota's minute window regardless of the caller's IP", async () => {
    const minute = WINDOWS.find((window) => window.span === "minute");
    expect(minute).toBeDefined();
    const testEnv = fakeEnv({ FEEDBACK_QUOTA: env.FEEDBACK_QUOTA });
    for (let i = 0; i < minute!.limit; i++) {
      const request = new Request("https://relay.test/report", {
        // A different source address every time: this is exactly the case
        // the per-IP and per-location layers cannot bound.
        headers: { "cf-connecting-ip": `10.0.0.${String(i)}` }
      });
      await expect(allow(testEnv, request)).resolves.toBe(true);
    }
    await expect(
      allow(
        testEnv,
        new Request("https://relay.test/report", {
          headers: { "cf-connecting-ip": "10.9.9.9" }
        })
      )
    ).resolves.toBe(false);
  });

  it("never spends quota on a request the cheap layers already refused", async () => {
    const refusing = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(false) as unknown as RateLimit,
      FEEDBACK_QUOTA: env.FEEDBACK_QUOTA
    });
    await expect(allow(refusing, report())).resolves.toBe(false);
    // The quota is untouched, so a legitimate caller still gets the full
    // window rather than paying for a request that never reached GitHub.
    const quotaOnly = fakeEnv({ FEEDBACK_QUOTA: env.FEEDBACK_QUOTA });
    const minute = WINDOWS.find((window) => window.span === "minute");
    for (let i = 0; i < minute!.limit; i++) {
      await expect(allow(quotaOnly, report())).resolves.toBe(true);
    }
  });

  it("sends every request to the one named instance, not one per caller", async () => {
    expect(env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME).toString()).toBe(
      env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME).toString()
    );
  });
});
