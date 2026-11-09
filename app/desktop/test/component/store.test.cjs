// The store's round trips that start a process: the snapshot through the real CLI, and a streamed command through a
// stub binary. APP-272: everything that checks only what the app sends `lore`, or what it makes of the answer, runs
// against a stand-in in process in test/unit/store.test.cjs.
const assert = require("node:assert/strict");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../src/state.cjs.
const { CLI, readState } = require("../../support/scratch.cjs");

// APP-272: the one real round trip for `lore desktop-state`, the snapshot every view of the app reads.
test("reads only the fixed APP-001 snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const state = await readState(directory);
    assert.equal(state.version, 1);
    assert.equal(state.home, directory);
    assert.equal(state.node.live.state, "not_configured");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a streamed CLI command hands back each line and fails on a non-zero exit", async () => {
  const { loreStream, useRuntime } = require("../../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const fake = join(directory, "lore");
  await writeFile(fake, '#!/bin/sh\necho "Visit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?x=1"\ntest "$2" = login && exit 0\necho "lore: Cloudflare sign-in did not complete" >&2\nexit 1\n', { mode: 0o755 });
  const lines = [];
  try {
    useRuntime(fake);
    await loreStream(directory, ["node", "login"], (line) => lines.push(line));
    assert.match(lines[0], /^Visit this link/);
    await assert.rejects(loreStream(directory, ["node", "deploy"], (line) => lines.push(line)), /exited with 1/);
    assert.equal(lines.at(-1), "lore: Cloudflare sign-in did not complete");
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});
