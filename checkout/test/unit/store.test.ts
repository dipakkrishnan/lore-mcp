// XC-102: which store origins checkout takes, and which Stripe key a test store's sale needs, as
// tables. What /create and /accounts/bind answer for each is test/checkout.test.ts.
import { describe, expect, it } from "vitest";
import { type Listing, keyFits, storeOrigin } from "../../src/store";
import { listing } from "../stubs";

describe("storeOrigin", () => {
  it.each([
    ["an https origin", "https://store.test", "https://store.test"],
    ["an https origin with a port", "https://store.test:8443", "https://store.test:8443"],
    ["plain http on localhost", "http://localhost:8787", "http://localhost:8787"],
    ["plain http on 127.0.0.1", "http://127.0.0.1:8787", "http://127.0.0.1:8787"],
    // Exactly as a store page posts it: anything the URL parser would rewrite isn't an origin.
    ["a trailing slash", "https://store.test/", null],
    ["a path", "https://store.test/p/abc", null],
    ["a query", "https://store.test?x=1", null],
    ["upper case", "https://Store.test", null],
    ["a default port spelled out", "https://store.test:443", null],
    ["credentials", "https://user@store.test", null],
    ["plain http anywhere else", "http://store.test", null],
    ["plain http on a lookalike of localhost", "http://localhost.store.test", null],
    ["plain http on another loopback address", "http://127.0.0.2", null],
    ["another scheme", "javascript:alert(1)", null],
    ["a file URL", "file:///etc/passwd", null],
    ["not a URL", "store.test", null],
    ["nothing", "", null]
  ])("%s (%o) → %o", (_, value, expected) => {
    expect(storeOrigin(value)).toBe(expected);
  });
});

describe("keyFits", () => {
  const env = (key: string) => ({ STRIPE_SECRET_KEY: key }) as Env;
  it.each<[string, Partial<Listing>, string, boolean]>([
    ["a live store, a live key", { test: false }, "sk_live_abc", true],
    ["a live store, a test key", { test: false }, "sk_test_abc", true],
    ["a test store, a test secret key", { test: true }, "sk_test_abc", true],
    ["a test store, a test restricted key", { test: true }, "rk_test_abc", true],
    ["a test store, a live secret key", { test: true }, "sk_live_abc", false],
    ["a test store, a live restricted key", { test: true }, "rk_live_abc", false],
    ["a test store, a key that only mentions test", { test: true }, "sk_live_test_", false],
    ["a test store, no key", { test: true }, "", false]
  ])("%s → %o", (_, store, key, expected) => {
    expect(keyFits(listing(store), env(key))).toBe(expected);
  });
});
