// The MON-005 invariants: testnet is the only default, mainnet is opt-in and
// fails closed without CDP credentials. Pure unit tests on the leaf module —
// the paid path itself is covered by paid-path.test.ts.
import { describe, expect, it } from "vitest";
import { MAINNET, TESTNET, facilitator, network, type NetworkEnv } from "../src/network";

function env(overrides: Partial<NetworkEnv> = {}): NetworkEnv {
  return overrides as NetworkEnv;
}

describe("network", () => {
  it("defaults to Base Sepolia when LORE_NETWORK is unset or empty", () => {
    expect(network(env())).toBe(TESTNET);
    expect(network(env({ LORE_NETWORK: "" }))).toBe(TESTNET);
  });

  it("reaches mainnet only when spelled out exactly", () => {
    expect(network(env({ LORE_NETWORK: MAINNET }))).toBe(MAINNET);
  });

  it("rejects any other network instead of guessing", () => {
    expect(() => network(env({ LORE_NETWORK: "mainnet" }))).toThrow(/LORE_NETWORK/);
    expect(() => network(env({ LORE_NETWORK: "eip155:1" }))).toThrow(/LORE_NETWORK/);
  });
});

describe("facilitator", () => {
  it("uses the credential-free test facilitator on testnet", () => {
    expect(facilitator(env()).url).toBe("https://x402.org/facilitator");
    expect(facilitator(env({ LORE_FACILITATOR_URL: "https://facilitator.test" as never })).url).toBe(
      "https://facilitator.test"
    );
  });

  it("fails closed on mainnet without CDP credentials", () => {
    expect(() => facilitator(env({ LORE_NETWORK: MAINNET }))).toThrow(/CDP/);
    expect(() =>
      facilitator(env({ LORE_NETWORK: MAINNET, CDP_API_KEY_ID: "key-id" }))
    ).toThrow(/CDP/);
  });

  it("returns an authenticated CDP facilitator on mainnet", () => {
    const config = facilitator(
      env({ LORE_NETWORK: MAINNET, CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" })
    );
    expect(config.url).toContain("cdp.coinbase.com");
    expect(config.createAuthHeaders).toBeTypeOf("function");
  });

  it("never sends testnet traffic to the CDP facilitator by accident", () => {
    const config = facilitator(
      env({ CDP_API_KEY_ID: "key-id", CDP_API_KEY_SECRET: "key-secret" })
    );
    expect(config.url).toBe("https://x402.org/facilitator");
    expect(config.createAuthHeaders).toBeUndefined();
  });
});
