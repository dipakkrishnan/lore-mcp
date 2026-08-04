// The money math. Everything here is one assertion restated: a price in dollars
// must become an exact integer of USDC base units, because an inexact one is
// either a RangeError at payment time or a charge for the wrong amount.
import { describe, expect, it } from "vitest";
import { PRICE_USD, usdcBaseUnits } from "../../lore/node/src/price.js";

describe("PRICE_USD", () => {
  it("is the one place the canary price is written down", () => {
    // `src/index.ts` advertises it in discover and charges it in paidTool, and
    // `scripts/pay.ts` caps the buyer's spend with it. A second literal anywhere
    // is a node that quotes one price and charges another.
    expect(PRICE_USD).toBe(0.01);
  });
});

describe("usdcBaseUnits", () => {
  it("scales dollars by USDC's six decimals", () => {
    expect(usdcBaseUnits(1)).toBe(1_000_000n);
    expect(usdcBaseUnits(0)).toBe(0n);
    expect(usdcBaseUnits(2.5)).toBe(2_500_000n);
  });

  it("survives binary floating point", () => {
    // This is why Math.round is in there. $2.01 * 1_000_000 is
    // 2009999.9999999998 in IEEE 754, and BigInt() on a non-integer throws
    // RangeError — so without the rounding, setting the price to $2.01 would
    // make every payment fail at the moment of charging.
    expect(Number.isInteger(2.01 * 1_000_000)).toBe(false);
    expect(usdcBaseUnits(2.01)).toBe(2_010_000n);
    // The canary price itself happens to be exact, which is precisely why this
    // bug would not have shown up in the smoke check.
    expect(usdcBaseUnits(PRICE_USD)).toBe(10_000n);
  });

  it("returns an exact integer for every price the node could be set to", () => {
    for (let cents = 0; cents <= 500; cents++) {
      const usd = cents / 100;
      expect(usdcBaseUnits(usd)).toBe(BigInt(cents) * 10_000n);
    }
  });

  it("rounds sub-unit amounts rather than truncating or throwing", () => {
    // A seventh decimal cannot be represented on-chain; rounding is a decision,
    // and it is the one that never under-charges by a whole unit.
    expect(usdcBaseUnits(0.0000004)).toBe(0n);
    expect(usdcBaseUnits(0.0000006)).toBe(1n);
  });
});
