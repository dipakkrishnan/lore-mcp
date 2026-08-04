// The payout guard. `payTo` runs when the Durable Object builds its server, so
// a node with no usable wallet refuses to start rather than serving paid answers
// that pay nobody. The address shape is duplicated in `lore/deploy.py` (WALLET),
// which is why the last test here pins the two to the same rule.
import { describe, expect, it } from "vitest";
import { payTo } from "../../lore/node/src/wallet.js";

const VALID = `0x${"1".repeat(40)}`;

function env(wallet?: string): Env {
  return { LORE_WALLET: wallet } as unknown as Env;
}

describe("payTo", () => {
  it("returns a well-formed public address unchanged", () => {
    expect(payTo(env(VALID))).toBe(VALID);
    // EIP-55 checksummed addresses are mixed case and must be accepted as-is;
    // lower-casing one would send funds to a different string than the owner gave.
    const checksummed = "0xAbC0000000000000000000000000000000000dEf";
    expect(payTo(env(checksummed))).toBe(checksummed);
  });

  it("fails closed when the secret was never set", () => {
    // This is the case `lore node deploy` spends a `wrangler secret list` call
    // to catch early; the Worker must still refuse if that check is bypassed.
    expect(() => payTo(env(undefined))).toThrow(/public EVM address/);
    expect(() => payTo(env(""))).toThrow(/public EVM address/);
  });

  it("rejects anything that is not exactly forty hex characters", () => {
    for (const wallet of [
      `0x${"1".repeat(39)}`,
      `0x${"1".repeat(41)}`,
      "1".repeat(40), // no 0x prefix
      `0X${"1".repeat(40)}`, // uppercase prefix is not the format wrangler stores
      `0x${"g".repeat(40)}`,
      ` ${VALID}`,
      `${VALID} `,
      "not an address"
    ]) {
      expect(() => payTo(env(wallet)), wallet).toThrow(/public EVM address/);
    }
  });

  it("never accepts a private key as a payout address", () => {
    // A 64-hex string is a secret, not an address. Accepting one would mean an
    // owner pasted their key into a Worker secret and it silently "worked".
    expect(() => payTo(env(`0x${"1".repeat(64)}`))).toThrow(/public EVM address/);
  });
});
