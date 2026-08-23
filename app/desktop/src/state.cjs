const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

/** @type {{file: string, args: string[], cwd?: string}} */
let runtime = { file: "uv", args: ["run", "lore"], cwd: root };

/** @param {string} [file] */
function useRuntime(file) {
  runtime = file ? { file, args: [] } : { file: "uv", args: ["run", "lore"], cwd: root };
}

/** @param {string} loreHome @param {string[]} args @param {string} [decision] */
async function lore(loreHome, args, decision) {
  const attended = decision === undefined ? {} : { LORE_ATTENDED_SURFACE: "desktop" };
  const env = { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1", ...attended };
  const pending = run(runtime.file, [...runtime.args, ...args], {
    cwd: runtime.cwd,
    env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true
  });
  pending.child.stdin?.end(decision);
  try {
    return (await pending).stdout;
  } catch (error) {
    const stderr = String(/** @type {{stderr?: string}} */ (error).stderr ?? "").trim();
    throw new Error((stderr.split("\n").pop() ?? "").replace(/^lore: /, "") || "Lore could not finish that");
  }
}

/** @param {string} loreHome */
async function readState(loreHome) {
  const value = JSON.parse(await lore(loreHome, ["desktop-state"]));
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Lore returned an unsupported desktop state");
  }
  return /** @type {Snapshot} */ (value);
}

/** @param {string} loreHome @param {string} query @returns {Promise<SearchHit[]>} */
async function searchMemories(loreHome, query) {
  const terms = query.trim().split(/\s+/).filter((term) => term && !term.startsWith("-")).slice(0, 8);
  if (!terms.length) return [];
  return JSON.parse(await lore(loreHome, ["search", ...terms, "--status", "private", "--limit", "30", "--json"]));
}

/** @param {string} loreHome @param {unknown} id @returns {Promise<Memory>} */
async function readMemory(loreHome, id) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  return JSON.parse(await lore(loreHome, ["memory", "show", String(id), "--json"]));
}

/** @param {string} loreHome @returns {Promise<PublicationCandidate[]>} */
async function candidates(loreHome) {
  return JSON.parse(await lore(loreHome, ["publication", "candidates"]));
}

/** @param {string} loreHome @param {PublicationCandidate} candidate @param {boolean} approve */
async function decide(loreHome, candidate, approve) {
  await lore(loreHome, ["publication", "decide"], JSON.stringify({ candidate, approve }));
}

module.exports = { lore, readState, searchMemories, readMemory, candidates, decide, useRuntime };
