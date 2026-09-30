/** The network guard, a leaf module like the price and the wallet.
 *
 * Resolved while the Durable Object builds its server, so a misconfigured
 * node refuses to start instead of taking payment on the wrong chain.
 * Mainnet is opt-in only (MON-005): it must be spelled out in LORE_NETWORK —
 * real money never moves because an environment variable went missing.
 * It settles through PayAI, which needs no keys, unless the owner vaulted
 * their own Coinbase CDP credentials (MON-025). A facilitator only submits
 * the buyer's signed transfer, which already fixes the recipient and amount,
 * so choosing one never puts money in anyone's hands but the owner's.
 */
import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig } from "@x402/core/http";

export const TESTNET = "eip155:84532"; // Base Sepolia, play money
export const MAINNET = "eip155:8453"; // Base, real money
export const KEYLESS_FACILITATOR = "https://facilitator.payai.network";

// LORE_NETWORK and the CDP credentials arrive as deploy-time configuration
// (`wrangler secret put`), so the generated env.d.ts never sees them; typed
// here instead so this module survives `npm run types`.
export type NetworkEnv = Env & {
  LORE_NETWORK?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
};

export function network(env: NetworkEnv): string {
  const value = env.LORE_NETWORK || TESTNET;
  if (value !== TESTNET && value !== MAINNET) {
    throw new Error(`LORE_NETWORK must be ${TESTNET} (test) or ${MAINNET} (mainnet), not: ${value}`);
  }
  return value;
}

/** Unmistakable at a glance wherever the node names itself. */
export function networkLabel(env: NetworkEnv): string {
  return network(env) === MAINNET ? "MAINNET" : "test";
}

export function facilitator(env: NetworkEnv): FacilitatorConfig {
  if (network(env) === TESTNET) {
    return { url: env.LORE_FACILITATOR_URL || "https://x402.org/facilitator" };
  }
  if (!env.CDP_API_KEY_ID && !env.CDP_API_KEY_SECRET) {
    return { url: env.LORE_FACILITATOR_URL || KEYLESS_FACILITATOR };
  }
  // Half a credential pair is a mistake, not a choice: refuse to start rather
  // than quietly settling somewhere the owner did not pick.
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    throw new Error(
      "CDP credentials come in pairs: " +
        "npx wrangler secret put CDP_API_KEY_ID and CDP_API_KEY_SECRET, or delete both"
    );
  }
  return createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
}
