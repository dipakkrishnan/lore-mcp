/** Single source of truth for the deployed price, shared by the Worker and buyer script. */
export const PRICE_USD = 0.01;

/** USDC has 6 decimals, so on-chain amounts are dollars scaled by 1e6. */
export function usdcBaseUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}
