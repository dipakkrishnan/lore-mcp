// APP-061: the credential store, reached without Electron. A stub safeStorage stands in for the Keychain;
// app.test.cjs's "safeStorage credentials survive an Electron restart" stays the one proof of the real one.
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { chmod, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");

const MARK = Buffer.from("enc:");

/** A reversible stand-in for Electron's safeStorage: Buffers in and out, and a decrypt that throws on
 * bytes it did not write or while encryption is unavailable, as the real one does. */
function keychain() {
  const stub = {
    available: true,
    decrypts: 0,
    /** @param {number} _count */
    onDecrypt: (_count) => {},
    isEncryptionAvailable: () => stub.available,
    /** @param {string} text */
    encryptString: (text) => Buffer.concat([MARK, Buffer.from(Buffer.from(text).toString("base64"))]),
    /** @param {Buffer} bytes */
    decryptString: (bytes) => {
      stub.onDecrypt(++stub.decrypts);
      if (!stub.available || !bytes.subarray(0, MARK.length).equals(MARK)) {
        throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      }
      return Buffer.from(bytes.subarray(MARK.length).toString(), "base64").toString();
    }
  };
  return stub;
}

/** @param {import("node:test").TestContext} t */
async function scratch(t) {
  const { CredentialStore } = await import("../src/credentials.mjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-credentials-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "userData", "credentials.bin");
  const safe = keychain();
  /** @param {unknown} credentials */
  const seed = async (credentials) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, safe.encryptString(JSON.stringify(credentials)));
  };
  return { path, safe, seed, store: new CredentialStore(path, /** @type {never} */ (safe)) };
}

const key = (value) => ({ type: "api_key", key: value });

test("two changes to one provider at once both land, the second seeing the first", async (t) => {
  const { safe, seed, store } = await scratch(t);
  await seed({ anthropic: key("old") });
  /** @type {() => void} */
  let open = () => {};
  const gate = new Promise((resolve) => (open = () => resolve(undefined)));
  // Unchained, the second change's load is the second decrypt and it reads the file before the first change
  // has saved; chained, that load cannot start until the first is done, so the timer is what lets it go.
  safe.onDecrypt = (count) => count === 2 && open();
  const fallback = setTimeout(open, 50);
  /** @type {unknown[]} */
  const seen = [];
  const results = await Promise.allSettled([
    store.modify("anthropic", async (current) => {
      await gate;
      return { ...current, refreshed: true };
    }),
    store.modify("anthropic", async (current) => {
      seen.push(current);
      return { ...current, pasted: true };
    })
  ]);
  clearTimeout(fallback);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
  assert.deepEqual(seen, [{ type: "api_key", key: "old", refreshed: true }], "the second change ran on the first's result");
  assert.deepEqual(await store.read("anthropic"), { type: "api_key", key: "old", refreshed: true, pasted: true });
});

test("changes to two providers at once both land: an OAuth refresh never loses a key pasted meanwhile", async (t) => {
  const { store } = await scratch(t);
  await Promise.all([
    store.modify("anthropic", async () => key("a")),
    store.modify("openai", async () => key("b")),
    store.modify("google", async () => key("c"))
  ]);
  assert.deepEqual(await store.read("anthropic"), key("a"));
  assert.deepEqual(await store.read("openai"), key("b"));
  assert.deepEqual(await store.read("google"), key("c"));
});

test("a change that throws rejects, writes nothing, and does not stop the next one", async (t) => {
  const { path, seed, store } = await scratch(t);
  await seed({ anthropic: key("kept") });
  const before = await readFile(path);
  await assert.rejects(
    store.modify("anthropic", async () => {
      throw new Error("refresh failed");
    }),
    /refresh failed/
  );
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(await store.modify("anthropic", async (current) => ({ ...current, key: "next" })), key("next"));
});

test("a change that returns nothing writes nothing and answers with what is stored", async (t) => {
  const { path, seed, store } = await scratch(t);
  assert.equal(await store.modify("anthropic", async () => undefined), undefined);
  assert.equal(existsSync(path), false, "an empty store is not written to");
  await seed({ anthropic: key("kept") });
  assert.deepEqual(await store.modify("anthropic", async () => undefined), key("kept"));
});

test("list names each provider and its credential type, never the secret", async (t) => {
  const { store } = await scratch(t);
  assert.deepEqual(await store.list(), []);
  await store.modify("anthropic", async () => key("sk-ant-secret"));
  await store.modify("openai", async () => ({ type: "oauth", access: "oauth-secret", refresh: "r", expires: 1 }));
  const listed = await store.list();
  assert.deepEqual(listed, [
    { providerId: "anthropic", type: "api_key" },
    { providerId: "openai", type: "oauth" }
  ]);
  assert.doesNotMatch(JSON.stringify(listed), /secret/);
});

test("delete removes that provider only, and deleting one that is absent is fine", async (t) => {
  const { store } = await scratch(t);
  await store.modify("anthropic", async () => key("a"));
  await store.modify("openai", async () => key("b"));
  await store.delete("anthropic");
  assert.equal(await store.read("anthropic"), undefined);
  assert.deepEqual(await store.read("openai"), key("b"));
  await store.delete("anthropic");
  assert.deepEqual(await store.list(), [{ providerId: "openai", type: "api_key" }]);
});

test("with the Keychain unavailable and nothing stored, a save refuses and leaves no file behind", async (t) => {
  const { path, safe, store } = await scratch(t);
  safe.available = false;
  assert.equal(await store.read("anthropic"), undefined);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.modify("anthropic", async () => key("a")), /Keychain is unavailable/);
  assert.equal(existsSync(path), false);
  assert.equal(existsSync(`${path}.tmp`), false);
  safe.available = true;
  assert.deepEqual(await store.modify("anthropic", async () => key("a")), key("a"), "a refused save does not jam the queue");
});

test("with the Keychain unavailable, stored credentials are refused, not overwritten, and come back with it", async (t) => {
  const { path, safe, seed, store } = await scratch(t);
  await seed({ anthropic: key("kept") });
  const before = await readFile(path);
  safe.available = false;
  await assert.rejects(store.read("anthropic"), /decrypt/);
  await assert.rejects(store.list(), /decrypt/);
  await assert.rejects(store.modify("openai", async () => key("b")), /decrypt/);
  await assert.rejects(store.delete("anthropic"), /decrypt/);
  assert.deepEqual(await readFile(path), before);
  safe.available = true;
  await store.modify("openai", async () => key("b"));
  assert.deepEqual(await store.read("anthropic"), key("kept"));
  assert.deepEqual(await store.read("openai"), key("b"));
});

test("a credentials file that will not decrypt, or is not JSON, is refused and never overwritten", async (t) => {
  const { path, safe, store } = await scratch(t);
  await mkdir(dirname(path), { recursive: true });
  for (const [bytes, error] of /** @type {const} */ ([
    [Buffer.from("written by another machine's Keychain"), /decrypt/],
    [safe.encryptString("not json"), SyntaxError]
  ])) {
    await writeFile(path, bytes);
    await assert.rejects(store.read("anthropic"), error);
    await assert.rejects(store.list(), error);
    await assert.rejects(store.modify("anthropic", async () => key("a")), error);
    await assert.rejects(store.delete("anthropic"), error);
    assert.deepEqual(await readFile(path), bytes, "the store never replaces credentials it could not read");
  }
});

test("the stored file is encrypted, owner-only, and replaced through a temp file and rename", async (t) => {
  const { path, store } = await scratch(t);
  await store.modify("anthropic", async () => key("sk-ant-plaintext"));
  const first = await readFile(path);
  assert.equal(first.includes("sk-ant-plaintext"), false);
  assert.equal(existsSync(`${path}.tmp`), false);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);

  // A temp file a crash left behind keeps its own mode through the write; the save still ends owner-only.
  await writeFile(`${path}.tmp`, "", { mode: 0o644 });
  await chmod(`${path}.tmp`, 0o644);
  // A rename puts a new file at the path; a write in place would change what the old link sees too.
  const previous = `${path}.previous`;
  await link(path, previous);
  await store.modify("openai", async () => key("b"));
  assert.deepEqual(await readFile(previous), first, "the old file was replaced, not written over");
  assert.notDeepEqual(await readFile(path), first);
  assert.equal(existsSync(`${path}.tmp`), false);
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await store.read("anthropic"), key("sk-ant-plaintext"));
});
