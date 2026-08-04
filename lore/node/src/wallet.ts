/** The payout guard, kept in its own leaf module like the price.
 *
 * `payTo` runs while the Durable Object builds its server, so a node with no
 * usable wallet refuses to start rather than serving paid answers that pay
 * nobody. Living here rather than in `index.ts` means it can be exercised
 * without standing up an MCP server.
 *
 * The same address shape is enforced ahead of deployment by `WALLET` in
 * `lore/deploy.py`; both exist so a mistake costs seconds, not a live node.
 */
const PUBLIC_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function payTo(env: Env): `0x${string}` {
  if (!PUBLIC_ADDRESS.test(env.LORE_WALLET ?? "")) {
    throw new Error("LORE_WALLET must be a public EVM address");
  }
  return env.LORE_WALLET as `0x${string}`;
}
