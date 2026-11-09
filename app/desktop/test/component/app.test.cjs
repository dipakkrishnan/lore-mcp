// The desktop app's round-trips that need a real `lore` or a stub binary: the packaged runtime, dictation through a stub
// whisper, connecting an app, listing the store, an agent with no store, and the packaging guard. XC-097: split from
// test/unit/app.test.cjs; each of these starts a process, so they are component tests. APP-272: the blueprint and
// collection tests, which check only what the app sends `lore`, run against a stand-in in test/unit/app.test.cjs.
const assert = require("node:assert/strict");
const { mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../../src/state.cjs.
const { CLI, readState } = require("../../support/scratch.cjs");

test("useRuntime runs the packaged binary instead of uv", async () => {
  const { useRuntime } = require("../../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const bin = join(directory, "lore");
    await writeFile(bin, '#!/bin/sh\necho \'{"version":1}\'\n', { mode: 0o755 });
    useRuntime(bin);
    const state = await readState(directory);
    assert.equal(state.version, 1);
    // The packaged CLI runs from the Lore home, never from wherever the app was launched.
    await writeFile(bin, "#!/bin/sh\nprintf '{\"cwd\":\"%s\"}' \"$PWD\"\n", { mode: 0o755 });
    const { lore } = require("../../src/state.cjs");
    assert.equal(JSON.parse(await lore(directory, [])).cwd, await realpath(directory));
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("dictation transcribes through the bundled whisper and leaves no audio behind", async () => {
  const { MAX_WAV_BYTES, transcribe } = require("../../src/dictation.cjs");
  const dir = await mkdtemp(join(tmpdir(), "lore-dictation-"));
  const bin = join(dir, "whisper-cli");
  await writeFile(bin, '#!/bin/sh\ncp "$4" "$(dirname "$0")/seen.wav"\nprintf " [BLANK_AUDIO] Add the management layer first.\\n"\n', { mode: 0o755 });
  try {
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    const text = await transcribe({ bin, model: "model.bin", dir }, wav);
    assert.equal(text, "Add the management layer first.");
    assert.equal((await readFile(join(dir, "seen.wav"))).subarray(0, 4).toString(), "RIFF");
    assert.deepEqual((await require("node:fs/promises").readdir(dir)).filter((name) => name.endsWith(".wav") && name !== "seen.wav"), []);
    await assert.rejects(transcribe({ bin, model: "model.bin", dir }, Buffer.alloc(43)), /between 44 bytes and 20 MB/);
    await assert.rejects(transcribe({ bin, model: "model.bin", dir }, Buffer.alloc(MAX_WAV_BYTES + 1)), /between 44 bytes and 20 MB/);
  } finally {
    await rm(dir, { recursive: true });
  }
});

// APP-272: the one real round trip for `lore sources`: connect, read, replace and remove through the real parser.
test("connecting an app validates before any CLI call, then round-trips through the CLI with the app kept on its row", async () => {
  const { sourceCatalog, sourceChoices, connectSource, readSource, removeSource, readState } = require("../../src/state.cjs");
  await assert.rejects(sourceChoices("/nonexistent", "../etc"), { message: /Unknown app/ });
  await assert.rejects(connectSource("/nonexistent", { connector: "obsidian", locator: " " }), { message: /Choose what to connect/ });
  await assert.rejects(connectSource("/nonexistent", { connector: "obsidian", locator: "/v", replace: "../etc" }), { message: /Unknown source/ });
  await assert.rejects(readSource("/nonexistent", "../etc"), { message: /Unknown source/ });
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const obsidian = join(directory, "obsidian");
  const vault = join(directory, "Personal");
  await mkdir(obsidian);
  await mkdir(vault);
  await writeFile(join(obsidian, "obsidian.json"), JSON.stringify({ vaults: { a1: { path: vault, ts: 1, open: true } } }));
  await writeFile(join(vault, "note.md"), "# Note\n\nA lesson long enough to be worth keeping.");
  process.env.OBSIDIAN_HOME = obsidian;
  try {
    assert.deepEqual((await sourceCatalog(directory)).map((app) => [app.id, app.kind]), [["obsidian", "folder"], ["chatgpt", "export"], ["claude", "export"], ["google-maps", "export"], ["substack", "feed"], ["medium", "feed"], ["bluesky", "feed"], ["blog", "feed"], ["letterboxd", "feed"], ["goodreads", "feed"], ["granola", "mcp"], ["notion", "mcp"], ["readwise", "mcp"], ["agent", "agent"]]);
    // Offered under the path its source will keep, so a vault already connected is recognised (APP-215).
    assert.deepEqual(await sourceChoices(directory, "obsidian"), [{ label: "Personal", locator: await realpath(vault), open: true }]);
    await assert.rejects(connectSource(directory, { connector: "evernote", locator: vault }), { message: /unknown app/ });
    // Closing the sheet aborts the read, and nothing is connected.
    await assert.rejects(connectSource(directory, { connector: "obsidian", locator: vault }, AbortSignal.abort()), { message: "Cancelled" });
    assert.equal((await readState(directory)).library.sources.filter((source) => source.connector).length, 0);
    const added = await connectSource(directory, { connector: "obsidian", locator: vault });
    assert.equal(added.connector, "obsidian");
    assert.equal(added.state, "connected");
    assert.equal(added.imported, 1);
    assert.equal((await readState(directory)).library.sources.find((source) => source.connector === "obsidian")?.label, "Personal");
    await writeFile(join(vault, "second.md"), "# Second\n\nAnother lesson long enough to be worth keeping.");
    assert.equal((await readSource(directory, added.name))[0].added, 1);
    // A change to a vault that is not there leaves the working one connected; a real one takes over.
    await assert.rejects(connectSource(directory, { connector: "obsidian", locator: join(directory, "gone"), replace: added.name }), { message: /can't reach/ });
    assert.equal((await readState(directory)).library.sources.filter((source) => source.connector === "obsidian").length, 1);
    const other = join(directory, "Work");
    await mkdir(other);
    await writeFile(join(other, "plan.md"), "# Plan\n\nA work lesson long enough to be worth keeping.");
    const changed = await connectSource(directory, { connector: "obsidian", locator: other, replace: added.name });
    assert.deepEqual((await readState(directory)).library.sources.filter((source) => source.connector === "obsidian").map((source) => source.name), [changed.name]);
    assert.deepEqual((await removeSource(directory, changed.name, true)).memories, { kept: 1 });
  } finally {
    delete process.env.OBSIDIAN_HOME;
    await rm(directory, { recursive: true });
  }
});

// APP-272: the one real round trip for `lore marketplace` and the push it makes, against a stub wrangler.
test("listing switches the store on through the CLI and hands back the request form", async () => {
  const { listStore, listingStatus } = require("../../src/state.cjs");
  await assert.rejects(listStore("/nonexistent", "publish"), { message: /Invalid listing action/ });

  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const file = join(directory, "marketplace.json");
  const previous = { PATH: process.env.PATH, LORE_MARKETPLACE_URL: process.env.LORE_MARKETPLACE_URL };
  try {
    // A deployed node whose push always succeeds, and a public list this test controls.
    await writeFile(join(process.env.LORE_STORE ?? "", "wrangler.jsonc"), "{}");
    await mkdir(join(directory, "bin"));
    await writeFile(join(directory, "bin", "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(file, JSON.stringify({ sellers: [] }));
    process.env.PATH = `${join(directory, "bin")}:${process.env.PATH}`;
    process.env.LORE_MARKETPLACE_URL = pathToFileURL(file).href;
    spawnSync("uv", ["run", "python", "-c", `
from lore.store import Store
from lore import blueprint
import json
with Store() as store:
    store.set_setting("node_url", "https://lore.example.workers.dev/mcp")
    store.set_setting("node_selling", True)
blueprint.blueprint_path().parent.mkdir(parents=True, exist_ok=True)
blueprint.blueprint_path().write_text(json.dumps({"name": "Ada"}))
`], { cwd: join(__dirname, "../../../.."), env: { ...process.env, LORE_HOME: directory }, stdio: "inherit" });
    assert.deepEqual(await listingStatus(directory), { state: "none" });
    assert.deepEqual(await listStore(directory, "list"), {
      state: "pending",
      action: "list",
      url: "https://github.com/dipakkrishnan/lore-marketplace/issues/new?template=listing.yml&node=https%3A%2F%2Flore.example.workers.dev%2Fmcp"
    });
    await writeFile(file, JSON.stringify({ sellers: [{ node: "https://lore.example.workers.dev/mcp" }] }));
    assert.deepEqual(await listingStatus(directory), { state: "listed" });
    assert.deepEqual(await listStore(directory, "delist"), { state: "none" });
    assert.deepEqual(await listingStatus(directory), { state: "pending", action: "delist" });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true });
  }
});

test("packaging refuses while a copy runs from the output bundle", async () => {
  const { spawn } = require("node:child_process");
  const bundle = await mkdtemp(join(tmpdir(), "lore-guard-"));
  const binary = join(bundle, "Contents/MacOS/Lore");
  await mkdir(dirname(binary), { recursive: true });
  await writeFile(binary, "#!/bin/bash\nsleep 30\n", { mode: 0o755 });
  const guard = () => spawnSync(join(__dirname, "../../support/guard-running.sh"), { env: { ...process.env, LORE_GUARD_BUNDLE: bundle }, encoding: "utf8" });
  assert.equal(guard().status, 0, "nothing running: packaging proceeds");
  const running = spawn(binary, { stdio: "ignore" });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const refused = guard();
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Quit it first/);
  } finally {
    running.kill();
    await rm(bundle, { recursive: true, force: true });
  }
});

// APP-272: the one real round trip for `lore agents`.
test("with no store online, connecting an agent says so and mints nothing", async () => {
  const { connectAgent, listAgents, agentsWaiting } = require("../../src/state.cjs");
  const loreHome = await mkdtemp(join(tmpdir(), "lore-agents-"));
  try {
    await assert.rejects(connectAgent(loreHome, { app: "grok", name: "Grok" }), { message: /put your store online first/ });
    assert.deepEqual(await listAgents(loreHome), []);
    assert.deepEqual(await agentsWaiting(loreHome), { waiting: 0, sources: [], sign_ins: [] }, "no agent, so nobody is asked");
  } finally {
    await rm(loreHome, { recursive: true });
  }
});
