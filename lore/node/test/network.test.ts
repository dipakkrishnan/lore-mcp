// The MON-005 invariants: testnet is the only default and mainnet is opt-in.
// Mainnet settles keyless through PayAI unless the owner vaulted a full CDP pair. Pure unit tests on the leaf module —
// the paid path itself is covered by paid-path.test.ts.
import { describe, expect, it } from "vitest";
import {
  KEYLESS_FACILITATOR,
  MAINNET,
  TESTNET,
  TEST_FACILITATOR,
  facilitator,
  network,
  type NetworkEnv
} from "../src/network";
import wranglerConfig from "../wrangler.jsonc?raw";

function env(overrides: Partial<NetworkEnv> = {}): NetworkEnv {
  return overrides as NetworkEnv;
}

type Vars = Record<string, string>;

// The config an owner's `wrangler deploy` actually ships, comments and
// trailing commas stripped so JSON.parse can read it.
function shippedVars(): { default: Vars; qa: Vars } {
  const json = wranglerConfig
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (token) => (token.startsWith('"') ? token : ""))
    .replace(/,(\s*[}\]])/g, "$1");
  const config = JSON.parse(json) as { vars: Vars; env: { qa: { vars: Vars } } };
  return { default: config.vars, qa: config.env.qa.vars };
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
    expect(facilitator(env()).url).toBe(TEST_FACILITATOR);
    expect(facilitator(env({ LORE_FACILITATOR_URL: "https://facilitator.test" as never })).url).toBe(
      "https://facilitator.test"
    );
  });

  it("settles mainnet through the keyless facilitator when no CDP pair is vaulted", () => {
    const config = facilitator(env({ LORE_NETWORK: MAINNET }));
    expect(config.url).toBe(KEYLESS_FACILITATOR);
    expect(config.createAuthHeaders).toBeUndefined();
  });

  it("fails closed on mainnet with half a CDP pair", () => {
    expect(() =>
      facilitator(env({ LORE_NETWORK: MAINNET, CDP_API_KEY_ID: "key-id" }))
    ).toThrow(/CDP/);
    expect(() =>
      facilitator(env({ LORE_NETWORK: MAINNET, CDP_API_KEY_SECRET: "key-secret" }))
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
    expect(config.url).toBe(TEST_FACILITATOR);
    expect(config.createAuthHeaders).toBeUndefined();
  });
});

// MON-042: the unit tests above build their env by hand, so they stayed green
// while the shipped config sent keyless real-money stores to x402.org.
describe("the shipped wrangler.jsonc", () => {
  it("names no facilitator for an owner's node", () => {
    expect(shippedVars().default).not.toHaveProperty("LORE_FACILITATOR_URL");
  });

  it("settles a keyless real-money store through PayAI", () => {
    const config = facilitator(env({ ...shippedVars().default, LORE_NETWORK: MAINNET }));
    expect(config.url).toBe(KEYLESS_FACILITATOR);
    expect(config.createAuthHeaders).toBeUndefined();
  });

  it("keeps a test-network store on x402.org", () => {
    expect(facilitator(env(shippedVars().default as Partial<NetworkEnv>)).url).toBe(TEST_FACILITATOR);
  });

  it("keeps the maintainers' QA node on x402.org", () => {
    const qa = shippedVars().qa;
    expect(qa.LORE_FACILITATOR_URL).toBe(TEST_FACILITATOR);
    expect(facilitator(env(qa as Partial<NetworkEnv>)).url).toBe(TEST_FACILITATOR);
  });
});
