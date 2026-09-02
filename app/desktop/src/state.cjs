const { execFile, spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
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

/** @param {string} file @param {string[]} args @param {Record<string, string>} env @param {(line: string) => void} onLine @param {string} [cwd] */
function stream(file, args, env, onLine, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    for (const output of [child.stdout, child.stderr]) {
      if (output) createInterface({ input: output }).on("line", (line) => line.trim() && onLine(line.trim()));
    }
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(undefined) : fail(new Error(`${file} exited with ${code}`))));
  });
}

/** Run the CLI and hand back each output line as it arrives, for commands that wait on the owner. @param {string} loreHome @param {string[]} args @param {(line: string) => void} onLine */
function loreStream(loreHome, args, onLine) {
  return stream(runtime.file, [...runtime.args, ...args], { LORE_HOME: loreHome, NO_COLOR: "1" }, onLine, runtime.cwd);
}

/** @param {string} loreHome */
async function readState(loreHome) {
  const value = JSON.parse(await lore(loreHome, ["desktop-state"]));
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Lore returned an unsupported desktop state");
  }
  return /** @type {Snapshot} */ (value);
}

/** @param {string} loreHome @returns {Promise<Sale[]>} */
async function readSales(loreHome) {
  return JSON.parse(await lore(loreHome, ["node", "sales", "--json"]));
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

/** @param {string} loreHome @param {unknown} id @param {string} content @returns {Promise<Memory>} */
async function editMemory(loreHome, id, content) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Content cannot be empty");
  // Over stdin, not argv: content that starts with a dash is not an option.
  return JSON.parse(await lore(loreHome, ["memory", "edit", String(id), "--stdin", "--json"], trimmed));
}

/** Save the memories exactly as the owner kept them on the card. @param {string} loreHome @param {ProposedMemory[]} entries @returns {Promise<SavedMemory[]>} */
async function captureMemories(loreHome, entries) {
  if (!entries.length) return [];
  return JSON.parse(await lore(loreHome, ["capture", "apply", "-"], JSON.stringify(entries)));
}

/** @param {string} loreHome @returns {Promise<PublicationCandidate[]>} */
async function candidates(loreHome) {
  return JSON.parse(await lore(loreHome, ["publication", "candidates"]));
}

/** @param {string} loreHome @param {PublicationCandidate} original @param {PublicationCandidate} candidate @param {boolean} approve */
async function decide(loreHome, original, candidate, approve) {
  await lore(loreHome, ["publication", "decide"], JSON.stringify({ original, candidate, approve }));
}

module.exports = {
  lore,
  loreStream,
  stream,
  readState,
  readSales,
  searchMemories,
  readMemory,
  editMemory,
  captureMemories,
  candidates,
  decide,
  useRuntime
};
