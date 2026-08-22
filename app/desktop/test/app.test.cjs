const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
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

test("keeps the renderer behind fixed sandboxed bridges", async () => {
  const source = join(__dirname, "../src");
  const [main, preload, renderer, state, agent, html] = await Promise.all(
    ["main.cjs", "preload.cjs", "renderer.js", "state.cjs", "agent.mjs", "index.html"].map((file) =>
      readFile(join(source, file), "utf8")
    )
  );
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.equal((main.match(/ipcMain\.handle/g) || []).length, 5);
  assert.match(main, /ipcMain\.handle\("snapshot:read", readState\)/);
  assert.match(main, /request\("bash-approval", \{ command \}\)\) === true/);
  assert.equal((preload.match(/exposeInMainWorld/g) || []).length, 1);
  assert.match(preload, /ipcRenderer\.invoke\("snapshot:read"\)/);
  assert.doesNotMatch(preload + renderer, /node:child_process|node:fs/);
  assert.doesNotMatch(renderer, /\brequire\s*\(/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage/);
  assert.match(state, /run\("uv", \["run", "lore", "desktop-state"\]/);
  assert.match(agent, /tools: \["read", "bash", "ask_user"\]/);
  assert.match(agent, /pi\.on\("tool_call"/);
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

test("blocks native Bash when the owner denies it", async () => {
  const { bashApprovalExtension } = await import("../src/agent.mjs");
  let handler;
  const extension = bashApprovalExtension(async (command) => {
    assert.equal(command, "lore status");
    return false;
  });
  await extension.factory({
    on(event, callback) {
      assert.equal(event, "tool_call");
      handler = callback;
    }
  });
  const result = await handler({
    type: "tool_call",
    toolName: "bash",
    toolCallId: "call-1",
    input: { command: "lore status" }
  });
  assert.equal(result.block, true);
  assert.equal(result.terminate, true);
});

test("safeStorage credentials survive an Electron restart", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-credentials-"));
  const electron = require("electron");
  const child = join(__dirname, "../support/credential-roundtrip.cjs");
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const mode of ["write", "read"]) {
      const result = spawnSync(electron, ["--no-sandbox", child, mode, directory], {
        encoding: "utf8",
        env,
        timeout: 30_000
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const encrypted = await readFile(join(directory, "credentials.bin"));
    assert.equal(encrypted.includes("test-secret"), false);
  } finally {
    await rm(directory, { recursive: true });
  }
});
