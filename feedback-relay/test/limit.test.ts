import { describe, expect, it, vi } from "vitest";
import { allow } from "../src/limit";

function limiter(success: boolean) {
  return { limit: vi.fn().mockResolvedValue({ success }) };
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
  return {
    // allow() never reads this; kept as the literal wrangler.jsonc default
    // so this fake satisfies Env's generated type without a cast.
    LORE_GITHUB_API: "https://api.github.com",
    LORE_FEEDBACK_GITHUB_TOKEN: "test-token",
    // Absent under `wrangler dev` and in most tests — see src/limit.ts.
    FEEDBACK_RATE_LIMIT: undefined as unknown as RateLimit,
    GLOBAL_RATE_LIMIT: undefined as unknown as RateLimit,
    ...overrides
  };
}

describe("allow", () => {
  it("allows when neither binding is present", async () => {
    await expect(allow(fakeEnv(), new Request("https://relay.test/report"))).resolves.toBe(
      true
    );
  });

  it("allows when both bindings succeed", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(true) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(true) as unknown as RateLimit
    });
    await expect(allow(env, new Request("https://relay.test/report"))).resolves.toBe(true);
  });

  it("denies when the per-IP limiter denies", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(false) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(true) as unknown as RateLimit
    });
    await expect(allow(env, new Request("https://relay.test/report"))).resolves.toBe(false);
  });

  it("denies when the global limiter denies", async () => {
    const env = fakeEnv({
      FEEDBACK_RATE_LIMIT: limiter(true) as unknown as RateLimit,
      GLOBAL_RATE_LIMIT: limiter(false) as unknown as RateLimit
    });
    await expect(allow(env, new Request("https://relay.test/report"))).resolves.toBe(false);
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
    await allow(env, new Request("https://relay.test/report"));
    expect(feedback.limit).toHaveBeenCalledWith({ key: "unknown" });
  });

  it("keys the global limiter on a constant, not the caller", async () => {
    const global = limiter(true);
    const env = fakeEnv({ GLOBAL_RATE_LIMIT: global as unknown as RateLimit });
    await allow(env, new Request("https://relay.test/report"));
    expect(global.limit).toHaveBeenCalledWith({ key: "global" });
  });
});
