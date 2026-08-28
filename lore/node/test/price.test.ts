import { describe, expect, it } from "vitest";
import { PRICE_USD, usdcBaseUnits } from "../src/price.js";

describe("PRICE_USD", () => {
  it("is the one place the canary price is written down", () => {
    expect(PRICE_USD).toBe(0.01);
  });
});

describe("usdcBaseUnits", () => {
  it("scales dollars by USDC's six decimals without floating-point drift", () => {
    expect(usdcBaseUnits(1)).toBe(1_000_000n);
    expect(usdcBaseUnits(0)).toBe(0n);
    expect(usdcBaseUnits(2.5)).toBe(2_500_000n);
    expect(usdcBaseUnits(2.01)).toBe(2_010_000n);
    expect(usdcBaseUnits(PRICE_USD)).toBe(10_000n);
  });

  it("returns an exact integer for every cent price through five dollars", () => {
    for (let cents = 0; cents <= 500; cents++) {
      expect(usdcBaseUnits(cents / 100)).toBe(BigInt(cents) * 10_000n);
    }
  });

  it("rounds sub-unit amounts", () => {
    expect(usdcBaseUnits(0.0000004)).toBe(0n);
    expect(usdcBaseUnits(0.0000006)).toBe(1n);
  });
});
