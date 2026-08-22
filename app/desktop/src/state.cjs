const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

async function readState(loreHome = process.env.LORE_HOME || "") {
  const { stdout } = await run("uv", ["run", "lore", "desktop-state"], {
    cwd: root,
    env: { ...process.env, LORE_HOME: loreHome },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20_000,
    windowsHide: true
  });
  const value = JSON.parse(stdout);
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Lore returned an unsupported desktop state");
  }
  return /** @type {Snapshot} */ (value);
}

module.exports = { readState };
