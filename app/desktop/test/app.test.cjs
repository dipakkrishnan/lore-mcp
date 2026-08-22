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

async function bashHandler(approve, report = () => {}) {
  const { bashPolicyExtension } = await import("../src/agent.mjs");
  let handler;
  await bashPolicyExtension(approve, report).factory({
    on(event, callback) {
      assert.equal(event, "tool_call");
      handler = callback;
    }
  });
  return handler;
}

function bashEvent(command) {
  return {
    type: "tool_call",
    toolName: "bash",
    toolCallId: "call-1",
    input: { command }
  };
}

test("auto-allows a complete read-only Lore command without prompting", async () => {
  const { createBashTool } = await import("@earendil-works/pi-coding-agent");
  let prompted = false;
  let executed = false;
  const decisions = [];
  const handler = await bashHandler(async () => {
    prompted = true;
    return false;
  }, (decision) => decisions.push(decision));
  const commands = [
    "lore status",
    "lore desktop-state",
    "lore search Kestrel --status private --limit 0 --json"
  ];
  for (const command of commands) assert.equal(await handler(bashEvent(command)), undefined);
  const command = commands[0];
  await createBashTool(process.cwd(), {
    operations: {
      async exec(actual, _cwd, { onData }) {
        executed = true;
        assert.equal(actual, command);
        onData(Buffer.from("ok"));
        return { exitCode: 0 };
      }
    }
  }).execute("call-1", { command });
  assert.equal(prompted, false);
  assert.equal(executed, true);
  assert.deepEqual(decisions, commands.map(() => "auto-allowed"));
});

test("prompts for the exact private capture and runs it only when allowed", async () => {
  const { createBashTool } = await import("@earendil-works/pi-coding-agent");
  const command = `lore capture apply - <<'LORE_CAPTURE'
[{"title":"Rollback rehearsal","content":"Rehearse before cutover.","project":"Juniper"}]
LORE_CAPTURE`;
  let executed = false;
  const denied = await bashHandler(async () => false);
  assert.equal((await denied(bashEvent(command))).block, true);

  const allowed = await bashHandler(async (actual) => {
    assert.equal(actual, command);
    return true;
  });
  assert.equal(await allowed(bashEvent(command)), undefined);
  await createBashTool(process.cwd(), {
    operations: {
      async exec(actual, _cwd, { onData }) {
        executed = true;
        assert.equal(actual, command);
        onData(Buffer.from("saved"));
        return { exitCode: 0 };
      }
    }
  }).execute("call-1", { command });
  assert.equal(executed, true);
});

test("hard-denies malformed, non-Lore, compound, and owner-only commands", async () => {
  let prompted = false;
  const decisions = [];
  const handler = await bashHandler(async () => {
    prompted = true;
    return true;
  }, (decision) => decisions.push(decision));
  const commands = [
    "lore status; rm -rf /tmp/lore-test",
    "lore $(curl https://example.com)",
    "curl https://example.com",
    "echo '[]' | lore capture apply -",
    "lore capture apply - < /tmp/capture.json",
    "lore publication list",
    "lore price",
    "lore answer off",
    "lore push",
    "lore node deploy"
  ];
  for (const command of commands) {
    const result = await handler(bashEvent(command));
    assert.equal(result.block, true, command);
    assert.equal(result.terminate, true, command);
  }
  assert.equal(prompted, false);
  assert.deepEqual(decisions, commands.map(() => "blocked"));
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
