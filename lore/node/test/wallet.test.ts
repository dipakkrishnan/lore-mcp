import { describe, expect, it } from "vitest";
import { payTo } from "../src/wallet.js";

const VALID = `0x${"1".repeat(40)}`;
const env = (wallet?: string) => ({ LORE_WALLET: wallet }) as unknown as Env;

describe("payTo", () => {
  it("returns a well-formed public address unchanged", () => {
    expect(payTo(env(VALID))).toBe(VALID);
    const checksummed = "0xAbC0000000000000000000000000000000000dEf";
    expect(payTo(env(checksummed))).toBe(checksummed);
  });

  it("fails closed without a usable wallet", () => {
    for (const wallet of [
      undefined,
      "",
      `0x${"1".repeat(39)}`,
      `0x${"1".repeat(41)}`,
      "1".repeat(40),
      `0X${"1".repeat(40)}`,
      `0x${"g".repeat(40)}`,
      ` ${VALID}`,
      `${VALID} `,
      `0x${"1".repeat(64)}`,
      "not an address"
    ]) expect(() => payTo(env(wallet)), wallet).toThrow(/public EVM address/);
  });
});
