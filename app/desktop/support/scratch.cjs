// Per-process scratch for the desktop unit tests (APP-248): each test file requires this first, so every node --test
// process gets its own store, keyring, launch-key folder and CLI runtime, and no file depends on another's state.
const { tmpdir } = require("node:os");
const { join } = require("node:path");
// The CLI these tests run keeps its store in scratch, never in the owner's Application Support.
process.env.LORE_STORE = require("node:fs").mkdtempSync(join(tmpdir(), "lore-store-"));
// Nor the owner's keychain: a CLI reading a connector's sign-in would otherwise ask macOS for the real "Lore" item.
process.env.PYTHON_KEYRING_BACKEND = "keyring.backends.null.Keyring";
// So do the launch keys it writes, and the CLI they run reads that scratch through a test-only entry point,
// as support/edge.cjs does: nothing here touches the owner's own keys.
const KEYS = require("node:fs").mkdtempSync(join(tmpdir(), "lore-keys-"));
const CLI = join(KEYS, "lore");
require("node:fs").writeFileSync(join(KEYS, "attended_cli.py"), `import sys\nfrom pathlib import Path\nfrom lore import cli\ncli.attended_folder = lambda: Path(${JSON.stringify(KEYS)})\nsys.exit(cli.main())\n`);
require("node:fs").writeFileSync(CLI, `#!/bin/sh\ncd ${JSON.stringify(join(__dirname, "../../.."))} && exec uv run python ${JSON.stringify(join(KEYS, "attended_cli.py"))} "$@"\n`, { mode: 0o755 });
process.once("exit", () => require("node:fs").rmSync(KEYS, { recursive: true, force: true }));
process.once("exit", () => require("node:fs").rmSync(/** @type {string} */ (process.env.LORE_STORE), { recursive: true, force: true }));
const { readState, useKeys, useRuntime } = require("../src/state.cjs");
useKeys(join(KEYS, "attended.d"));
useRuntime(CLI);

module.exports = { KEYS, CLI, readState };
