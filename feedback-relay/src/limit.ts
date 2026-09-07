/**
 * Two limiters: FEEDBACK_RATE_LIMIT keyed per client IP, GLOBAL_RATE_LIMIT on
 * a constant key so an IP-rotating caller cannot still flood the issue
 * tracker or burn the token's GitHub quota. KV is a poor counter here
 * (eventually consistent across colos, a write per request); a Durable
 * Object is correct but adds a class and a migration for one integer;
 * Turnstile needs a browser, which the CLI has none of. The Rate Limiting
 * binding is free with no extra infrastructure.
 *
 * Returns true (allow) when a binding is absent — the binding is not
 * reliably emulated everywhere `wrangler dev` runs, and this keeps the guard
 * a pure, independently testable module rather than dead code inside fetch.
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
  if (!checks.length) return true;
  const results = await Promise.all(checks);
  return results.every((result) => result.success);
}
