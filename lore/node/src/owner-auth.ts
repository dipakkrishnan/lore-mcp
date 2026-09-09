/** The owner's own free door into the answer agent, entirely outside x402.
 *
 * `LORE_OWNER_TOKEN` is a Worker secret Desktop mints and vaults on deploy
 * (`lore/deploy.py`), never typed by the owner. No token configured means
 * this route does not exist — a 404, not a 401, so a node the owner has
 * never opened Desktop against advertises nothing extra.
 */
import { timingSafeEqual } from "node:crypto";

// Not in the generated env.d.ts: like the model provider keys in answer.ts,
// this is a `wrangler secret`, never a `vars` entry, so it never appears there.
export type OwnerAuthEnv = Env & { LORE_OWNER_TOKEN?: string };

const encoder = new TextEncoder();

export function ownerAuthorized(request: Request, env: OwnerAuthEnv): boolean {
  const configured = env.LORE_OWNER_TOKEN;
  if (!configured) return false;
  const match = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return false;
  const provided = encoder.encode(match[1]);
  const expected = encoder.encode(configured);
  // timingSafeEqual throws on a length mismatch rather than comparing, so
  // that check has to come first — it leaks only the token's length, which
  // is fixed and already implied by how Desktop generates it.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
