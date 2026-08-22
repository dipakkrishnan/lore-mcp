const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { readState } = require("../src/state.cjs");

test("reads only the fixed APP-001 snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const previous = process.env.LORE_HOME;
  process.env.LORE_HOME = directory;
  try {
    const state = await readState();
    assert.equal(state.version, 1);
    assert.equal(state.node.live.state, "not_configured");
  } finally {
    if (previous === undefined) delete process.env.LORE_HOME;
    else process.env.LORE_HOME = previous;
    await rm(directory, { recursive: true });
  }
});

test("keeps the renderer behind one sandboxed data bridge", async () => {
  const source = join(__dirname, "../src");
  const [main, preload, renderer, state, html] = await Promise.all(
    ["main.cjs", "preload.cjs", "renderer.js", "state.cjs", "index.html"].map((file) =>
      readFile(join(source, file), "utf8")
    )
  );
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.equal((main.match(/ipcMain\.handle/g) || []).length, 1);
  assert.match(main, /ipcMain\.handle\("snapshot:read", readState\)/);
  assert.equal((preload.match(/exposeInMainWorld/g) || []).length, 1);
  assert.match(preload, /ipcRenderer\.invoke\("snapshot:read"\)/);
  assert.doesNotMatch(preload + renderer, /node:child_process|node:fs/);
  assert.doesNotMatch(renderer, /\brequire\s*\(/);
  assert.match(state, /run\("uv", \["run", "lore", "desktop-state"\]/);
  assert.match(html, /connect-src 'none'/);
  for (const text of [
    "No private memories yet.",
    "No node has been configured.",
    "Offline",
    "Lore could not load"
  ]) {
    assert.match(renderer, new RegExp(text.replace(".", "\\.")));
  }
});
