const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

/** @param {string} loreHome @param {string[]} args @param {string} [decision] */
async function lore(loreHome, args, decision) {
  const attended = decision === undefined ? {} : { LORE_ATTENDED_SURFACE: "desktop" };
  const env = { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1", ...attended };
  const pending = run("uv", ["run", "lore", ...args], {
    cwd: root,
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

/** @param {string} loreHome @returns {Promise<PublicationCandidate[]>} */
async function candidates(loreHome) {
  return JSON.parse(await lore(loreHome, ["publication", "candidates"]));
}

/** @param {string} loreHome @param {PublicationCandidate} candidate @param {boolean} approve */
async function decide(loreHome, candidate, approve) {
  await lore(loreHome, ["publication", "decide"], JSON.stringify({ candidate, approve }));
}

module.exports = { lore, readState, searchMemories, candidates, decide };
