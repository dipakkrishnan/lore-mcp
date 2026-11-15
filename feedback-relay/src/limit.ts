import { QUOTA_NAME } from "./quota.js";

/**
 * Three layers, in the order they cost the least to check:
 *
 * 1. `FEEDBACK_RATE_LIMIT` — a Rate Limiting binding keyed per client IP.
 *    Blunts one caller's burst. Checked first, before the body is read
 *    (`allowSender`): it costs only the sender's own address.
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
 * Layers 2 and 3 are shared by every owner, so they are spent only on a
 * report that has been read, parsed and accepted and is about to be filed
 * (`allowSpend`, XC-066): an oversize, malformed or refused request never
 * spends them.
 *
 * Each returns true (allow) when a layer's binding is absent, so these stay
 * pure functions that can be tested against fakes rather than dead code
 * inside fetch. Every layer is declared in wrangler.jsonc, so in a real
 * deployment none of them is absent.
 */
export async function allowSender(env: Env, request: Request): Promise<boolean> {
  if (!env.FEEDBACK_RATE_LIMIT) return true;
  // Absent under `wrangler dev` and in most tests; falling back to one
  // shared key merges every caller into one bucket — the safe direction,
  // not a bypass.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await env.FEEDBACK_RATE_LIMIT.limit({ key: ip })).success;
}

/** The shared layers, global limiter then quota, for a report about to be filed. */
export async function allowSpend(env: Env): Promise<boolean> {
  if (env.GLOBAL_RATE_LIMIT && !(await env.GLOBAL_RATE_LIMIT.limit({ key: "global" })).success) return false;
  if (env.FEEDBACK_QUOTA) {
    const quota = env.FEEDBACK_QUOTA.get(env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME));
    return await quota.take();
  }
  return true;
}

/** Every layer, in order: what a report that is about to be filed must pass. */
export async function allow(env: Env, request: Request): Promise<boolean> {
  return (await allowSender(env, request)) && (await allowSpend(env));
}
