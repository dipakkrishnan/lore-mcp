// The desktop sandbox: what the agent's tools may read, write and run, and the launch keys that admit the CLI.
// APP-248: split from app.test.cjs so node --test runs the desktop unit tests in parallel, one process per file.
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { access, constants, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { homedir, tmpdir, userInfo } = require("node:os");
const { basename, dirname, join, sep } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../src/state.cjs.
const { CLI, readState } = require("../support/scratch.cjs");
const { scriptedAgent, until } = require("../support/scripted.cjs");

/** A Lore home for one sandbox test, with the sandbox started on it. @param {Partial<import("../src/agent.mjs").Place>} [extra] */
async function sandboxed(extra = {}) {
  const { initializeSandbox } = await import("../src/agent.mjs");
  const root = await realpath(await mkdtemp(join(tmpdir(), "lore-sandbox-")));
  const loreHome = join(root, "lore");
  const place = { loreHome, ...extra };
  await initializeSandbox(place);
  return { root, loreHome, place };
}

/** Swap `dir` between itself and a link to `elsewhere`, outside the sandbox, until stopped. @param {string} dir @param {string} elsewhere */
function swapping(dir, elsewhere) {
  const script = 'while :; do mv "$1" "$1.real" && ln -s "$2" "$1" && rm "$1" && mv "$1.real" "$1"; done';
  // Its own process group, so stopping it also stops the mv or ln it is in the middle of.
  const child = spawn("/bin/bash", ["-c", script, "swap", dir, elsewhere], { stdio: "ignore", detached: true });
  const exited = new Promise((done) => child.once("exit", done));
  return async () => {
    process.kill(-(child.pid ?? 0), "SIGKILL");
    await exited;
    // Leave the real folder in place, whichever step the loop stopped on.
    if (existsSync(`${dir}.real`)) {
      await rm(dir, { force: true });
      await rename(`${dir}.real`, dir);
    }
  };
}

const TASKS_ALL = ["capture", "setup", "publish", "deploy", "synthesize", "checkin", "evening"];

test("desktop Bash is confined to Lore", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  const output = [];
  const run = (/** @type {string} */ command) => createSandboxedBashOperations(place).exec(command, loreHome, { onData: (data) => output.push(data) });
  try {
    const inside = join(loreHome, "inside");
    const escaped = join(root, "escaped");
    const result = await run(`printf inside > ${JSON.stringify(inside)}; printf escaped > ${JSON.stringify(escaped)}`);
    assert.equal(result.exitCode, 1);
    assert.equal(await readFile(inside, "utf8"), "inside");
    await assert.rejects(readFile(escaped, "utf8"), { code: "ENOENT" });
    assert.match(Buffer.concat(output).toString(), /Operation not permitted|sandbox_violations/);
    assert.equal((await run('printf "$TMPDIR" > "$TMPDIR/probe" && cat "$TMPDIR/probe"')).exitCode, 0);
    // AUT-010: in the app Lore keeps the rhythm, so nothing writes an agent's scheduler.
    assert.ok(!SandboxManager.getFsWriteConfig().allowOnly.includes(join(userInfo().homedir, ".codex/automations")));
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
});

test("no command the agent runs reaches the network, in any task", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, sandboxPolicy } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  try {
    for (const task of TASKS_ALL) {
      assert.deepEqual(sandboxPolicy(place, /** @type {AgentTask} */ (task)).network.allowedDomains, [], task);
      const output = [];
      const result = await createSandboxedBashOperations(place, /** @type {AgentTask} */ (task)).exec("curl -sS --max-time 5 -o /dev/null https://api.cloudflare.com/client/v4/", loreHome, { onData: (data) => output.push(data) });
      assert.notEqual(result.exitCode, 0, task);
      assert.deepEqual(SandboxManager.getConfig()?.network.allowedDomains, [], task);
    }
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
});

test("only setup reads the agents' memories, and no task reads their credential files", async () => {
  const { sandboxPolicy } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-policy-"));
  const history = [".claude/projects", ".codex/memories"].map((dir) => join(userInfo().homedir, dir));
  try {
    // APP-196: setup lists and imports the agents' history; every other task, and the sandbox's default, never sees it.
    for (const task of [...TASKS_ALL, undefined]) {
      const { allowRead } = sandboxPolicy({ loreHome: home }, /** @type {AgentTask | undefined} */ (task)).filesystem;
      for (const dir of history) assert.equal(allowRead.includes(dir), task === "setup", `${task}: ${dir}`);
      for (const dir of [".claude", ".codex"]) assert.ok(!allowRead.includes(join(userInfo().homedir, dir)), `${task}: ${dir} root, which holds auth.json and credentials`);
    }
  } finally {
    await rm(home, { recursive: true });
  }
});

// Read-only against the account's real history, since the policy is anchored there; skipped where there is none (CI).
const PROJECTS = join(userInfo().homedir, ".claude", "projects");
test("the agents' history is out of reach of every tool outside setup", { skip: process.platform !== "darwin" || !existsSync(PROJECTS) }, async () => {
  const { createSandboxedBashOperations, createSandboxedEditOperations, createSandboxedReadOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  // A small memory note to open, never a transcript, which can be larger than one read takes.
  const { readdirSync, statSync } = require("node:fs");
  const note = readdirSync(PROJECTS)
    .flatMap((project) => { try { return readdirSync(join(PROJECTS, project, "memory")).map((name) => join(PROJECTS, project, "memory", name)); } catch { return []; } })
    .find((path) => path.endsWith(".md") && statSync(path).isFile() && statSync(path).size < 65_536);
  try {
    for (const task of /** @type {AgentTask[]} */ (TASKS_ALL)) {
      const result = await createSandboxedBashOperations(place, task).exec(`ls ${JSON.stringify(PROJECTS)} >/dev/null`, loreHome, { onData: () => {} });
      assert.equal(result.exitCode === 0, task === "setup", `${task}: bash`);
      if (!note) continue;
      const opened = (/** @type {Promise<unknown>} */ promise) => promise.then(() => true, () => false);
      assert.equal(await opened(createSandboxedReadOperations(place, task).access(note)), task === "setup", `${task}: read`);
      assert.equal(await opened(createSandboxedEditOperations(place, task).readFile(note)), task === "setup", `${task}: edit`);
    }
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
});

test("the sandbox hides the account's home and the keys' folder, wherever HOME points", async () => {
  const { sandboxPolicy } = await import("../src/agent.mjs");
  const { ATTENDED_KEYS: key } = require("../src/state.cjs");
  assert.equal(key, join(userInfo().homedir, "Library", "Application Support", "Lore", "attended.d"));
  const home = await mkdtemp(join(tmpdir(), "lore-policy-"));
  const moved = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const task of TASKS_ALL) {
      const { denyRead, allowRead, allowWrite } = sandboxPolicy({ loreHome: home, binDir: "/Applications/Lore.app/Contents/Resources/bin", hidden: [dirname(key)] }, /** @type {AgentTask} */ (task)).filesystem;
      assert.equal(denyRead[0], userInfo().homedir, task);
      assert.ok(denyRead.includes(dirname(key)), task);
      assert.ok(![...allowRead, ...allowWrite].some((dir) => key === dir || key.startsWith(`${dir}/`)), `${task}: nothing lets the agent back in to it`);
    }
  } finally {
    process.env.HOME = moved;
    await rm(home, { recursive: true });
  }
});

test("each running app keeps its own launch key, and quitting removes only its own", async () => {
  const { LaunchKey } = require("../src/state.cjs");
  const root = await mkdtemp(join(tmpdir(), "lore-keys-"));
  const folder = join(root, "attended.d");
  try {
    const [first, second] = [new LaunchKey(folder), new LaunchKey(folder)];
    const keys = [first.env().LORE_ATTENDED_KEY, second.env().LORE_ATTENDED_KEY, first.env().LORE_ATTENDED_KEY];
    assert.equal(keys[0], keys[2]);
    assert.notEqual(keys[0], keys[1]);
    assert.equal((await stat(folder)).mode & 0o777, 0o700);
    for (const launch of [first, second]) {
      assert.equal((await stat(launch.file)).mode & 0o777, 0o600);
      assert.equal(await readFile(launch.file, "utf8"), `${process.pid}\n${launch.key}\n`);
      assert.ok(!launch.file.includes(launch.key), "the file is not named by its key");
    }
    first.remove();
    assert.deepEqual(await readdir(folder), [basename(second.file)]);
    // A later launch clears what a crashed app left, and keeps what a running one wrote.
    await writeFile(join(folder, "crashed"), `999999999\n${"a".repeat(64)}\n`);
    new LaunchKey(folder).env();
    assert.ok(!(await readdir(folder)).includes("crashed"));
    assert.ok((await readdir(folder)).includes(basename(second.file)));
  } finally {
    await rm(root, { recursive: true });
  }
});

test("a launch's key file is written once and never rewritten; a removed one comes back under a new name", async () => {
  const { LaunchKey } = require("../src/state.cjs");
  const root = await mkdtemp(join(tmpdir(), "lore-keys-"));
  const folder = join(root, "attended.d");
  try {
    const launch = new LaunchKey(folder);
    launch.env();
    const { file } = launch;
    const before = await stat(file);
    await new Promise((done) => setTimeout(done, 20));
    launch.env();
    const after = await stat(file);
    assert.equal(launch.file, file);
    assert.equal(after.ino, before.ino);
    assert.equal(after.mtimeMs, before.mtimeMs, "never rewritten in place");
    await rm(file);
    const { LORE_ATTENDED_KEY } = launch.env();
    assert.notEqual(launch.file, file);
    assert.equal(await readFile(launch.file, "utf8"), `${process.pid}\n${LORE_ATTENDED_KEY}\n`);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("clearing old keys never removes a running app's, however old, or one still being written", async () => {
  const { LaunchKey } = require("../src/state.cjs");
  const { utimes } = require("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "lore-keys-"));
  const folder = join(root, "attended.d");
  try {
    await mkdir(folder, { mode: 0o700 });
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await writeFile(join(folder, "running"), `${process.pid}\n${"a".repeat(64)}\n`, { mode: 0o600 });
    await utimes(join(folder, "running"), old, old);
    await writeFile(join(folder, "writing"), "", { mode: 0o600 });
    await writeFile(join(folder, "abandoned"), "", { mode: 0o600 });
    await utimes(join(folder, "abandoned"), old, old);
    new LaunchKey(folder).env();
    const left = await readdir(folder);
    assert.ok(left.includes("running"), "a running app's key stays, whatever its age");
    assert.ok(left.includes("writing"), "a file just created and not yet written stays");
    assert.ok(!left.includes("abandoned"), "an empty file left long ago goes");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("clearing old keys follows no link and never waits on a pipe or reads a huge file", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "lore-keys-"));
  const folder = join(root, "attended.d");
  try {
    await mkdir(folder, { mode: 0o700 });
    const elsewhere = join(root, "elsewhere");
    await writeFile(elsewhere, "999999999\nkey\n");
    await symlink(elsewhere, join(folder, "link"));
    spawnSync("mkfifo", [join(folder, "pipe")]);
    await writeFile(join(folder, "huge"), "");
    await require("node:fs/promises").truncate(join(folder, "huge"), 64 * 1024 * 1024);
    // In a child process, so a prune that blocks on the pipe fails this test instead of hanging the suite.
    const pruned = spawnSync(process.execPath, ["-e", `const { LaunchKey } = require(${JSON.stringify(require.resolve("../src/state.cjs"))}); new LaunchKey(${JSON.stringify(folder)}).env();`], { timeout: 10_000, encoding: "utf8" });
    assert.equal(pruned.status, 0, pruned.stderr || String(pruned.error));
    assert.ok(existsSync(elsewhere), "the link's target is untouched");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("the keys folder must be a real folder of the owner's, closed to everyone else", async () => {
  const { LaunchKey } = require("../src/state.cjs");
  const root = await mkdtemp(join(tmpdir(), "lore-keys-"));
  try {
    const open = join(root, "open");
    await mkdir(open, { mode: 0o755 });
    await require("node:fs/promises").chmod(open, 0o755);
    const launch = new LaunchKey(open);
    launch.env();
    assert.equal((await stat(open)).mode & 0o777, 0o700);
    assert.equal((await stat(launch.file)).mode & 0o777, 0o600);
    const real = join(root, "real");
    await mkdir(real, { mode: 0o700 });
    await symlink(real, join(root, "linked"));
    assert.throws(() => new LaunchKey(join(root, "linked")).env(), /not a folder Lore can trust/);
    assert.deepEqual(await readdir(real), []);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("the agent's shell can neither read a launch key nor add one", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { LaunchKey } = require("../src/state.cjs");
  // As main.cjs hides the folder that holds the keys; the policy test above checks that is the real one.
  const lore = await realpath(await mkdtemp(join(tmpdir(), "lore-account-")));
  const folder = join(lore, "attended.d");
  const launch = new LaunchKey(folder);
  launch.env();
  const planted = join(folder, "planted");
  const { root, loreHome, place } = await sandboxed({ hidden: [lore] });
  try {
    const bash = createSandboxedBashOperations(place);
    assert.equal((await bash.exec("ls . && printf ok > ok", loreHome, { onData: () => {} })).exitCode, 0, "the shell itself runs");
    let said = "";
    for (const command of [`ls ${JSON.stringify(folder)}`, `cat ${JSON.stringify(launch.file)}`, `printf '1\\nkey\\n' > ${JSON.stringify(planted)}`]) {
      // Refused either before it starts (APP-227 names the app's folders) or by the sandbox.
      const result = await bash.exec(command, loreHome, { onData: (data) => void (said += String(data)) }).catch(() => ({ exitCode: null }));
      assert.notEqual(result.exitCode, 0, command);
    }
    assert.ok(!said.includes(launch.key));
    assert.ok(!existsSync(planted));
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
    await rm(lore, { recursive: true, force: true });
  }
});

test("read goes through the sandbox: inside Lore yes; outside, through a link, or under a swapped folder never", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedReadOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "lore-outside-")));
  const { root, loreHome, place } = await sandboxed({ hidden: [outside] });
  const read = createSandboxedReadOperations(place, "capture");
  try {
    await writeFile(join(loreHome, "inside.md"), "inside");
    await writeFile(join(outside, "f"), "SECRET");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.alloc(17)]);
    await writeFile(join(loreHome, "shot.png"), png);
    await symlink(join(outside, "f"), join(loreHome, "link.md"));
    await read.access(join(loreHome, "inside.md"));
    assert.equal((await read.readFile(join(loreHome, "inside.md"))).toString(), "inside");
    assert.equal(await read.detectImageMimeType?.(join(loreHome, "shot.png")), "image/png");
    for (const path of [join(outside, "f"), join(loreHome, "link.md"), join(loreHome, "missing.md")]) {
      await assert.rejects(read.access(path), /Lore can't read that file/, path);
      await assert.rejects(read.readFile(path), /Lore can't read that file/, path);
      await assert.rejects(read.detectImageMimeType?.(path) ?? Promise.reject(new Error()), /Lore can't read that file/, path);
    }
    // A folder swapped for a link to the outside, over and over, while the agent reads through it.
    const dir = join(loreHome, "dir");
    await mkdir(dir);
    await writeFile(join(dir, "f"), "inside");
    const stop = swapping(dir, outside);
    const seen = new Set();
    try {
      for (let i = 0; i < 300; i++) seen.add(await read.readFile(join(dir, "f")).then((bytes) => bytes.toString(), () => "refused"));
    } finally {
      await stop();
    }
    assert.ok(!seen.has("SECRET"), "never anything from outside");
    assert.ok(seen.has("inside"), "the real file still reads");
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("write and edit go through the sandbox: never outside, through a link, or under a swapped folder", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedEditOperations, createSandboxedWriteOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "lore-outside-")));
  const { root, loreHome, place } = await sandboxed();
  const write = createSandboxedWriteOperations(place, "capture");
  const edit = createSandboxedEditOperations(place, "capture");
  try {
    const nested = join(loreHome, "notes", "inside.md");
    await write.mkdir(dirname(nested));
    await write.writeFile(nested, "inside");
    assert.equal(await readFile(nested, "utf8"), "inside");
    await edit.access(nested);
    assert.equal((await edit.readFile(nested)).toString(), "inside");
    await edit.writeFile(nested, "edited");
    assert.equal(await readFile(nested, "utf8"), "edited");

    await writeFile(join(outside, "f"), "SECRET");
    await symlink(join(outside, "f"), join(loreHome, "pwn.md"));
    for (const path of [join(outside, "f"), join(outside, "new.md"), join(loreHome, "pwn.md")]) {
      await assert.rejects(write.writeFile(path, "pwned"), /Lore can't write there/, path);
      await assert.rejects(edit.writeFile(path, "pwned"), /Lore can't write there/, path);
      await assert.rejects(edit.access(path), /Lore can't write there/, path);
    }
    await assert.rejects(write.mkdir(join(outside, "made")), /Lore can't write there/);

    const dir = join(loreHome, "dir");
    await mkdir(dir);
    await writeFile(join(dir, "f"), "inside");
    const stop = swapping(dir, outside);
    try {
      for (let i = 0; i < 300; i++) await write.writeFile(join(dir, "f"), "pwned").catch(() => {});
    } finally {
      await stop();
    }
    assert.equal(await readFile(join(outside, "f"), "utf8"), "SECRET");
    assert.deepEqual(await readdir(outside), ["f"]);
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("the agent's tools never update or deploy the store, and never write the app's own folders", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, createSandboxedEditOperations, createSandboxedWriteOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const keys = await realpath(await mkdtemp(join(tmpdir(), "lore-keys-")));
  const { root, loreHome, place } = await sandboxed({ hidden: [keys] });
  const output = [];
  const run = (/** @type {string} */ command) => createSandboxedBashOperations(place).exec(command, loreHome, { onData: (data) => output.push(data) });
  try {
    await writeFile(join(loreHome, "ran"), "");
    for (const command of ["lore push", "lore push --local", "uv run lore node deploy --network real", "lore node secret CDP_API_KEY_ID", "npx wrangler deploy", "cd node && wrangler d1 execute lore-publications --remote", "python -m lore.cli push"]) {
      await assert.rejects(run(`printf ran > ran; ${command}`), /Only the app updates the store/, command);
    }
    assert.equal(await readFile(join(loreHome, "ran"), "utf8"), "", "a refused command never starts");
    assert.equal((await run("printf ok > ok")).exitCode, 0, "everything else still runs");
    await assert.rejects(run(`printf x > ${JSON.stringify(join(keys, "k"))}`), /the app's own/);
    const write = createSandboxedWriteOperations(place, "capture");
    const edit = createSandboxedEditOperations(place, "capture");
    for (const path of [join(keys, "k"), join(keys, "sub", "k"), join(loreHome, "node", "wrangler.jsonc")]) {
      await assert.rejects(write.writeFile(path, "x"), /Lore can't write there/, path);
      await assert.rejects(edit.writeFile(path, "x"), /Lore can't write there/, path);
      await assert.rejects(edit.access(path), /Lore can't write there/, path);
    }
    await assert.rejects(write.mkdir(join(keys, "sub")), /Lore can't write there/);
    assert.deepEqual(await readdir(keys), []);
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
    await rm(keys, { recursive: true, force: true });
  }
});

test("the agent's shell, write and edit cannot change the store's files or the scheduled prompts, by any route",{ skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, createSandboxedEditOperations, createSandboxedWriteOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "lore-app-only-out-")));
  const { root, loreHome: home, place } = await sandboxed();
  const wrangler = join(home, "node", "node_modules", ".bin", "wrangler");
  const prompt = join(home, "automation", "synthesis-prompt.md");
  const output = [];
  // A command naming the store's tools is refused before it runs; the rest are stopped by the sandbox.
  const run = async (/** @type {string} */ command) => (await createSandboxedBashOperations(place).exec(command, home, { onData: (data) => output.push(data) }).catch(() => ({ exitCode: -1 }))).exitCode;
  try {
    await mkdir(dirname(wrangler), { recursive: true });
    await writeFile(wrangler, "the app's own");
    await writeFile(join(home, "planted"), "the agent's");
    await writeFile(prompt, "the app's own");
    const q = JSON.stringify;
    for (const target of [wrangler, prompt]) {
      const dir = dirname(target);
      assert.notEqual(await run(`printf x > ${q(target)}`), 0, `overwrite ${target}`);
      assert.notEqual(await run(`printf x > ${q(join(dir, "new"))}`), 0, `create in ${dir}`);
      assert.notEqual(await run(`mv ${q(join(home, "planted"))} ${q(target)}`), 0, `rename onto ${target}`);
      assert.notEqual(await run(`ln -sf ${q(join(home, "planted"))} ${q(join(dir, "link"))}`), 0, `symlink in ${dir}`);
      assert.notEqual(await run(`rm ${q(target)}`), 0, `remove ${target}`);
      assert.equal(await readFile(target, "utf8"), "the app's own");
    }
    for (const dir of ["node", "automation"]) {
      // Moving the folder away and putting another in its place is a write on the folder itself.
      assert.notEqual(await run(`mv ${q(join(home, dir))} ${q(join(home, `${dir}-old`))}`), 0, `rename ${dir}`);
      assert.notEqual(await run(`mv ${q(join(home, dir))} ${q(join(outside, dir))}`), 0, `move ${dir} out`);
    }
    // A store not yet opened has no node folder: the agent cannot make one, or a link where it goes.
    await rm(join(home, "node"), { recursive: true });
    assert.notEqual(await run(`mkdir -p ${q(dirname(wrangler))}`), 0);
    assert.notEqual(await run(`ln -s ${q(outside)} ${q(join(home, "node"))}`), 0);
    await assert.rejects(readFile(join(home, "node")), { code: "ENOENT" });
    // Everything else in Lore's home stays the agent's to write.
    assert.equal(await run(`printf ok > ${q(join(home, "memories.md"))}`), 0);

    const write = createSandboxedWriteOperations(place);
    const edit = createSandboxedEditOperations(place);
    await symlink(prompt, join(home, "to-prompt"));
    for (const path of [prompt, wrangler, join(home, "to-prompt")]) {
      await assert.rejects(write.writeFile(path, "x"), /Lore can't write there/, path);
      await assert.rejects(edit.writeFile(path, "x"), /Lore can't write there/, path);
    }
    await assert.rejects(write.mkdir(dirname(wrangler)), /Lore can't write there/);
    assert.equal(await readFile(prompt, "utf8"), "the app's own");
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("the agent's shell cannot change Lore's database", { skip: process.platform !== "darwin", todo: "Known gap: lore.db is writable inside the sandbox until an owner-only store for approvals and selling settings is decided" }, async () => {
  const { createSandboxedBashOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  try {
    await writeFile(join(loreHome, "lore.db"), "the app's own");
    const result = await createSandboxedBashOperations(place).exec(`printf x >> ${JSON.stringify(join(loreHome, "lore.db"))}`, loreHome, { onData: () => {} });
    assert.notEqual(result.exitCode, 0);
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
});

test("attachments: only regular files the agent could not have planted, within size, never a folder, a credential or Lore's own", async () => {
  const { checkAttachments, FILE_CAP } = require("../src/attachments.cjs");
  const root = await realpath(await mkdtemp(join(tmpdir(), "lore-attach-")));
  const loreHome = join(root, "lore");
  const kept = join(root, "kept");
  try {
    for (const dir of [loreHome, kept, join(root, "Desktop")]) await mkdir(dir, { recursive: true });
    const notes = join(root, "Desktop", "notes.md");
    await writeFile(notes, "what the owner attached");
    await writeFile(join(loreHome, "planted.md"), "x");
    await writeFile(join(kept, "attended"), "x");
    await writeFile(join(root, "Desktop", "id_ed25519"), "x");
    await writeFile(join(root, "Desktop", ".env"), "x");
    await symlink(join(loreHome, "planted.md"), join(root, "Desktop", "link.md"));
    assert.deepEqual(await checkAttachments(loreHome, [notes], [kept]), [{ name: "notes.md", path: notes, size: 23 }]);
    for (const path of [join(root, "Desktop"), root, join(loreHome, "planted.md"), join(root, "Desktop", "link.md"), join(kept, "attended"), join(root, "Desktop", "id_ed25519"), join(root, "Desktop", ".env"), join(root, "missing.md")]) {
      await assert.rejects(checkAttachments(loreHome, [path], [kept]), /Lore won't read/, path);
    }
    await assert.rejects(checkAttachments(loreHome, ["relative.md"], [kept]), /Invalid attachments/);
    // Sizes are checked before anything is read: one file over its cap, or a turn over the total.
    const big = join(root, "Desktop", "big.pdf");
    await writeFile(big, "");
    await require("node:fs/promises").truncate(big, FILE_CAP + 1);
    await assert.rejects(checkAttachments(loreHome, [big], [kept]), /big\.pdf is larger than Lore takes \(25 MB\)/);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      parts.push(join(root, "Desktop", `part-${i}.pdf`));
      await writeFile(parts[i], "");
      await require("node:fs/promises").truncate(parts[i], FILE_CAP - 1);
    }
    await assert.rejects(checkAttachments(loreHome, parts, [kept]), /together are more than Lore takes at once \(100 MB\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the agent reads its copy of an attachment, not the original, and a quiet task reads neither", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, createSandboxedReadOperations } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  // The original stands in for a file under the owner's home, which the sandbox hides.
  const desktop = await realpath(await mkdtemp(join(tmpdir(), "lore-desktop-")));
  const { agent, loreHome } = await scriptedAgent({ hidden: [desktop] });
  try {
    await writeFile(join(desktop, "notes.md"), "what the owner attached, and more written after the check");
    await import("../src/agent.mjs").then(({ initializeSandbox }) => initializeSandbox(agent.options));
    // Streamed one at a time, and only as many bytes as the file had when the app checked it.
    const [copy, empty] = await agent.attach([{ name: "notes.md", path: join(desktop, "notes.md"), size: 23 }, { name: "empty.md", path: join(desktop, "notes.md"), size: 0 }]);
    assert.equal(await readFile(empty, "utf8"), "");
    assert.ok(copy.includes(`${sep}attachments${sep}`), copy);
    const owner = createSandboxedReadOperations(agent.options, "capture");
    assert.equal((await owner.readFile(copy)).toString(), "what the owner attached");
    await assert.rejects(owner.readFile(join(desktop, "notes.md")), /Lore can't read that file/);
    for (const task of ["synthesize", "checkin"]) {
      await assert.rejects(createSandboxedReadOperations(agent.options, /** @type {AgentTask} */ (task)).readFile(copy), /Lore can't read that file/, task);
      const result = await createSandboxedBashOperations(agent.options, /** @type {AgentTask} */ (task)).exec(`cat ${JSON.stringify(copy)}`, loreHome, { onData: () => {} });
      assert.notEqual(result.exitCode, 0, task);
    }
  } finally {
    agent.dispose();
    await SandboxManager.reset();
    await rm(loreHome, { recursive: true, force: true });
    await rm(desktop, { recursive: true, force: true });
  }
});

test("a shell command with no limit of its own stops at Lore's default", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, BASH_TIMEOUT_S } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  try {
    assert.equal(BASH_TIMEOUT_S, 600);
    const started = Date.now();
    await assert.rejects(createSandboxedBashOperations(place, "capture", 1).exec("sleep 30", loreHome, { onData: () => {} }), /timeout/);
    assert.ok(Date.now() - started < 10_000);
    // A limit the agent names wins.
    assert.equal((await createSandboxedBashOperations(place, "capture", 1).exec("sleep 2", loreHome, { onData: () => {}, timeout: 10 })).exitCode, 0);
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
});

test("each task reads only its own conversation, and no read runs long or large", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedReadOperations, READ_CAP } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { root, loreHome, place } = await sandboxed();
  try {
    for (const task of ["capture", "synthesize"]) {
      await mkdir(join(loreHome, ".pi", "sessions", task), { recursive: true });
      await writeFile(join(loreHome, ".pi", "sessions", task, "s.jsonl"), task);
    }
    const quiet = createSandboxedReadOperations(place, "synthesize");
    assert.equal((await quiet.readFile(join(loreHome, ".pi", "sessions", "synthesize", "s.jsonl"))).toString(), "synthesize");
    await assert.rejects(quiet.readFile(join(loreHome, ".pi", "sessions", "capture", "s.jsonl")), /Lore can't read that file/);
    await assert.rejects(createSandboxedReadOperations(place, "capture").readFile(join(loreHome, ".pi", "sessions", "synthesize", "s.jsonl")), /Lore can't read that file/);

    const read = createSandboxedReadOperations(place, "capture");
    await writeFile(join(loreHome, "huge.txt"), Buffer.alloc(READ_CAP + 1, 97));
    await assert.rejects(read.readFile(join(loreHome, "huge.txt")), /larger than Lore reads at once/);
    spawnSync("mkfifo", [join(loreHome, "pipe")]);
    const started = Date.now();
    await assert.rejects(read.readFile(join(loreHome, "pipe")), /Lore can't read that file/);
    assert.ok(Date.now() - started < 5000, "a pipe is refused, not waited on");
  } finally {
    await SandboxManager.reset();
    await rm(root, { recursive: true, force: true });
  }
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

test("the bundled node is a shim that runs npm on Electron's embedded runtime", { skip: process.platform !== "darwin" }, async () => {
  const packaging = join(__dirname, "../packaging");
  const built = spawnSync(join(packaging, "node.sh"), { encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, built.stderr);
  const bin = join(packaging, "out/node/bin");
  const node = join(bin, "node");
  await access(node, constants.X_OK);
  assert.equal((await readFile(node)).subarray(0, 2).toString(), "#!", "bin/node must be a shim, not a standalone binary");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  // defaultApp keeps yargs-based CLIs (wrangler) reading the script from argv[1].
  const electron = spawnSync(node, ["-p", "process.versions.electron + ' ' + process.defaultApp"], { encoding: "utf8", env, timeout: 30_000 });
  assert.equal(electron.status, 0, electron.stderr);
  assert.equal(electron.stdout.trim(), `${require("electron/package.json").version} true`);
  const npm = spawnSync(join(bin, "npm"), ["--version"], { encoding: "utf8", env, timeout: 60_000 });
  assert.equal(npm.status, 0, npm.stderr);
  assert.match(npm.stdout, /^\d+\.\d+\.\d+/);
});

test("the agent's read tool is the sandboxed one: its copy of an attachment opens, a file Lore hides does not", { skip: process.platform !== "darwin" }, async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { initializeSandbox } = await import("../src/agent.mjs");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "lore-outside-")));
  const { agent, faux, loreHome } = await scriptedAgent({ hidden: [outside] });
  const secret = join(outside, "secret.md");
  /** @type {Array<{text: string, isError: boolean}>} */
  const results = [];
  try {
    await writeFile(secret, "top secret");
    await initializeSandbox(agent.options);
    await writeFile(join(outside, "notes.md"), "what the owner attached");
    const [copy] = await agent.attach([{ name: "notes.md", path: join(outside, "notes.md"), size: 23 }]);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: copy }, { id: "r-1" }), fauxToolCall("read", { path: secret }, { id: "r-2" })], { stopReason: "toolUse" }),
      (context) => {
        for (const message of context.messages) {
          if (message.role === "toolResult") results.push({ text: message.content.map((block) => (block.type === "text" ? block.text : "")).join(""), isError: message.isError });
        }
        return fauxAssistantMessage("Done.");
      }
    ]);
    await agent.prompt("Read these", "capture", undefined, undefined, undefined, [copy]);
    assert.deepEqual(results.map((result) => result.isError), [false, true]);
    assert.match(results[0].text, /what the owner attached/);
    assert.match(results[1].text, /Lore can't read that file/);
    assert.ok(!results[1].text.includes("top secret"));
  } finally {
    agent.dispose();
    await SandboxManager.reset();
    await rm(loreHome, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("the store opens through the app; the agent's own shell can neither stage it nor reach Cloudflare", { skip: process.platform !== "darwin" }, async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const { initializeSandbox } = await import("../src/agent.mjs");
  /** @type {OpenStore[]} */
  const opened = [];
  const { agent, faux, loreHome } = await scriptedAgent({ openStore: async (store) => { opened.push(store); return "The store is deployed."; } });
  const wallet = `0x${"a".repeat(40)}`;
  /** @type {string[]} */
  const results = [];
  faux.setResponses([
    // What `lore node deploy` needs first from a shell: the store's folder, then Cloudflare.
    fauxAssistantMessage(fauxToolCall("bash", { command: 'mkdir -p "$LORE_HOME/node/src"; echo "folder=$?"; curl -sS --max-time 5 -o /dev/null https://api.cloudflare.com/client/v4/; echo "network=$?"' }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("open_store", { network: "real", wallet }), { stopReason: "toolUse" }),
    (context) => {
      for (const message of context.messages) {
        if (message.role === "toolResult") results.push(message.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      }
      return fauxAssistantMessage("Your store is open.");
    }
  ]);
  try {
    await initializeSandbox(agent.options);
    await agent.prompt("Open my store", "deploy");
    assert.match(results[0], /folder=[1-9]/);
    assert.match(results[0], /network=[1-9]/);
    assert.ok(!existsSync(join(loreHome, "node")), "the agent staged nothing");
    assert.deepEqual(opened, [{ network: "real", wallet }]);
    assert.equal(results[1], "The store is deployed.");
  } finally {
    agent.dispose();
    await SandboxManager.reset();
    await rm(loreHome, { recursive: true, force: true });
  }
});
