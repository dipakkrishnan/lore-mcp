import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { approve, bridgeKey, decodeReceipt, parseBridgeArgs, UsageError } from "../src/policy.js";

const network = "eip155:84532";
const entry = (amount: string, net = network, scheme = "exact") => ({ scheme, network: net, amount });
const KEY = `0x${"ab".repeat(32)}` as const;
const OTHER_KEY = `0x${"cd".repeat(32)}` as const;
const unused = (): never => assert.fail("generated a key it should not have");

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "bridge-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("loading the module neither exits nor provisions a key", async (t) => {
  const home = tempDir(t);
  const saved = { home: process.env.HOME, key: process.env.X402_PRIVATE_KEY, argv: process.argv };
  t.after(() => {
    process.env.HOME = saved.home;
    if (saved.key === undefined) delete process.env.X402_PRIVATE_KEY;
    else process.env.X402_PRIVATE_KEY = saved.key;
    process.argv = saved.argv;
  });
  process.env.HOME = home;
  delete process.env.X402_PRIVATE_KEY;
  process.argv = [process.execPath, "policy"];

  // The query string forces a second evaluation under the temp HOME.
  const fresh = new URL("../src/policy.ts?load", import.meta.url).href;
  const loaded = (await import(fresh)) as typeof import("../src/policy.js");
  assert.equal(typeof loaded.approve, "function");
  assert.deepEqual(readdirSync(home), []);
});

test("approve pays the largest entry when every entry is acceptable", () => {
  assert.deepEqual(approve([entry("10"), entry("30"), entry("20")], network, 0n, 100n), {
    approved: true,
    amount: 30n
  });
});

test("approve declines a cheap decoy paired with an expensive entry", () => {
  const result = approve(
    [entry("10000", "eip155:11155111"), entry("5000000000")],
    network,
    0n,
    10000n
  );
  assert.deepEqual(result, {
    approved: false,
    reason: "option",
    detail: "exact on eip155:11155111"
  });
});

test("approve declines a challenge whose off-network entry comes last", () => {
  const result = approve([entry("1"), entry("1", "eip155:8453")], network, 0n, 100n);
  assert.equal(result.approved, false);
});

test("approve declines a scheme other than exact", () => {
  assert.deepEqual(approve([entry("1", network, "upto")], network, 0n, 100n), {
    approved: false,
    reason: "option",
    detail: `upto on ${network}`
  });
});

test("approve declines an empty challenge", () => {
  assert.deepEqual(approve([], network, 0n, 100n), {
    approved: false,
    reason: "option",
    detail: "empty accepts"
  });
});

test("approve declines an amount that is not a number", () => {
  const result = approve([entry("abc")], network, 0n, 100n);
  assert.equal(result.approved, false);
  assert.equal(result.approved === false && result.reason, "option");
});

test("approve counts what is already authorized against the cap", () => {
  assert.deepEqual(approve([entry("40")], network, 60n, 100n), { approved: true, amount: 40n });
  assert.deepEqual(approve([entry("41")], network, 60n, 100n), {
    approved: false,
    reason: "cap",
    amount: 41n
  });
  assert.deepEqual(approve([entry("1")], network, 0n, 0n), {
    approved: false,
    reason: "cap",
    amount: 1n
  });
});

test("approve measures the cap against the largest entry, not the first", () => {
  assert.deepEqual(approve([entry("1"), entry("101")], network, 0n, 100n), {
    approved: false,
    reason: "cap",
    amount: 101n
  });
});

// Current behaviour, reported on the PR rather than changed by this refactor.
test("approve treats negative and empty amounts as costing nothing", () => {
  assert.deepEqual(approve([entry("-5")], network, 100n, 100n), { approved: true, amount: 0n });
  assert.deepEqual(approve([entry("")], network, 100n, 100n), { approved: true, amount: 0n });
});

test("decodeReceipt reads the base64 header form", () => {
  const receipt = { success: true, transaction: "0xabc" };
  assert.deepEqual(decodeReceipt(btoa(JSON.stringify(receipt))), receipt);
});

test("decodeReceipt keeps a string it cannot decode", () => {
  assert.deepEqual(decodeReceipt("not base64 json!"), { raw: "not base64 json!" });
  assert.deepEqual(decodeReceipt(btoa("not json")), { raw: btoa("not json") });
});

test("decodeReceipt passes an object through and ignores anything else", () => {
  const receipt = { transaction: "0xabc" };
  assert.equal(decodeReceipt(receipt), receipt);
  assert.equal(decodeReceipt(undefined), undefined);
  assert.equal(decodeReceipt(null), undefined);
  assert.equal(decodeReceipt(7), undefined);
});

test("parseBridgeArgs applies the defaults", () => {
  assert.deepEqual(parseBridgeArgs(["--node", "https://n/mcp"]), {
    node: "https://n/mcp",
    network,
    maxUsd: 1,
    maxPaymentValue: 1000000n
  });
});

test("parseBridgeArgs requires --node", () => {
  assert.throws(() => parseBridgeArgs([]), (err: unknown) => {
    assert(err instanceof UsageError);
    assert.match(err.message, /^usage: x402-mcp-bridge --node/);
    return true;
  });
});

test("parseBridgeArgs converts the cap to USDC's six decimals", () => {
  const cap = (usd: string) => parseBridgeArgs(["--node", "u", "--max-usd", usd]).maxPaymentValue;
  assert.equal(cap("0.01"), 10000n);
  assert.equal(cap("0"), 0n);
  assert.equal(cap("0.0000004"), 0n);
  assert.equal(cap("0.0000006"), 1n);
});

test("parseBridgeArgs refuses a cap that is not a non-negative number", () => {
  for (const value of ["--max-usd=-1", "--max-usd=abc", "--max-usd=Infinity", "--max-usd=NaN"]) {
    assert.throws(
      () => parseBridgeArgs(["--node", "u", value]),
      (err: unknown) => {
        assert(err instanceof UsageError, value);
        assert.equal(err.message, "--max-usd must be a non-negative number");
        return true;
      }
    );
  }
});

test("parseBridgeArgs does not explain what it does not recognise", () => {
  const notUsage = (args: string[]) =>
    assert.throws(
      () => parseBridgeArgs(args),
      (err: unknown) => !(err instanceof UsageError)
    );
  notUsage(["--node", "u", "--max-usd", "-1"]);
  notUsage(["--node", "u", "--unknown"]);
  // Finite as a number, past what Math.round can hand BigInt once scaled.
  notUsage(["--node", "u", "--max-usd", "1e303"]);
});

test("bridgeKey takes a valid key from the environment and writes nothing", (t) => {
  const dir = tempDir(t);
  assert.equal(bridgeKey(unused, { X402_PRIVATE_KEY: KEY }, join(dir, "key.env")), KEY);
  assert.deepEqual(readdirSync(dir), []);
});

test("bridgeKey refuses a malformed key rather than falling back to the file", (t) => {
  const keyFile = join(tempDir(t), "key.env");
  writeFileSync(keyFile, `X402_PRIVATE_KEY=${OTHER_KEY}\n`);
  for (const bad of ["abc", KEY.slice(2), `${KEY}00`, `0x${"zz".repeat(32)}`]) {
    assert.throws(
      () => bridgeKey(unused, { X402_PRIVATE_KEY: bad }, keyFile),
      /not a 0x-prefixed 32-byte hex key/
    );
  }
});

test("bridgeKey reads an existing key file past its comments", (t) => {
  const keyFile = join(tempDir(t), "key.env");
  writeFileSync(keyFile, `# X402_PRIVATE_KEY=${OTHER_KEY}\nX402_PRIVATE_KEY=${KEY}\n`);
  assert.equal(bridgeKey(unused, {}, keyFile), KEY);
});

test("bridgeKey provisions a private key file once and reuses it", (t) => {
  // A strict umask would hide a directory or file created too open.
  const umask = process.umask(0);
  t.after(() => process.umask(umask));
  const keyFile = join(tempDir(t), "nested", "key.env");
  const key = bridgeKey(() => KEY, {}, keyFile);
  assert.equal(key, KEY);
  assert.equal(statSync(dirname(keyFile)).mode & 0o777, 0o700);
  assert.equal(statSync(keyFile).mode & 0o777, 0o400);
  assert.match(readFileSync(keyFile, "utf8"), new RegExp(`^X402_PRIVATE_KEY=${key}$`, "m"));
  assert.equal(bridgeKey(unused, {}, keyFile), key);
});
