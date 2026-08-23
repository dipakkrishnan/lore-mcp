const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

/** @param {string} loreHome @param {string[]} args */
async function lore(loreHome, args) {
  const { stdout } = await run("uv", ["run", "lore", ...args], {
    cwd: root,
    env: { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1" },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20_000,
    windowsHide: true
  });
  return JSON.parse(stdout);
}

/** @param {string} loreHome */
async function readState(loreHome) {
  const value = await lore(loreHome, ["desktop-state"]);
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Lore returned an unsupported desktop state");
  }
  return /** @type {Snapshot} */ (value);
}

/** @param {string} loreHome @param {string} query @returns {Promise<SearchHit[]>} */
async function searchMemories(loreHome, query) {
  const terms = query.trim().split(/\s+/).filter((term) => term && !term.startsWith("-")).slice(0, 8);
  if (!terms.length) return [];
  return lore(loreHome, ["search", ...terms, "--status", "private", "--limit", "30", "--json"]);
}

module.exports = { readState, searchMemories };
