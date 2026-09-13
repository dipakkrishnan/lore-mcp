import { QUOTA_NAME } from "./quota.js";

/**
 * Three layers, in the order they cost the least to check:
 *
 * 1. `FEEDBACK_RATE_LIMIT` — a Rate Limiting binding keyed per client IP.
 *    Blunts one caller's burst.
 * 2. `GLOBAL_RATE_LIMIT` — the same kind of binding on a constant key. Its
 *    counters are per Cloudflare location, so this is a **per-location
 *    pre-filter, not an aggregate bound**: a caller spread across locations
 *    gets one bucket per location. It stays because it absorbs most abuse
 *    without a Durable Object round trip, and for no other reason. See
 *    https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
 * 3. `FEEDBACK_QUOTA` — one Durable Object holding shared authoritative
 *    counters. This is the layer that actually bounds how many issues the
 *    relay's GitHub token can be made to create; see src/quota.ts.
 *
 * The Durable Object is asked last and only if the cheap layers passed, so a
 * request that was going to be refused anyway never spends quota.
 *
 * Returns true (allow) when a layer's binding is absent, so this stays a
 * pure function that can be tested against fakes rather than dead code
 * inside fetch. Every layer is declared in wrangler.jsonc, so in a real
 * deployment none of them is absent.
 */
export async function allow(env: Env, request: Request): Promise<boolean> {
  const checks: Promise<{ success: boolean }>[] = [];
  if (env.FEEDBACK_RATE_LIMIT) {
    // Absent under `wrangler dev` and in most tests; falling back to one
    // shared key merges every caller into one bucket — the safe direction,
    // not a bypass.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    checks.push(env.FEEDBACK_RATE_LIMIT.limit({ key: ip }));
  }
  if (env.GLOBAL_RATE_LIMIT) {
    checks.push(env.GLOBAL_RATE_LIMIT.limit({ key: "global" }));
  }
  if (checks.length) {
    const results = await Promise.all(checks);
    if (!results.every((result) => result.success)) return false;
  }
  if (env.FEEDBACK_QUOTA) {
    const quota = env.FEEDBACK_QUOTA.get(env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME));
    return await quota.take();
  }
  return true;
}
