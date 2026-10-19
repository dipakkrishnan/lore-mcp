// APP-215: where the first-run chat stands, kept across launches so a relaunch picks it up where the owner left it.
const { readFile, rename, writeFile } = require("node:fs/promises");

const STATES = ["started", "skipped", "done"];

class FirstRun {
  /** Every write waits its turn, so one asked later always lands later and no two share the temp file. @type {Promise<unknown>} */
  #turn = Promise.resolve();

  /** @param {string} file */
  constructor(file) {
    this.file = file;
  }

  /** Never started reads as null; so does a missing or damaged file. @returns {Promise<FirstRunState | null>} */
  async read() {
    try {
      const kept = JSON.parse(await readFile(this.file, "utf8"));
      if (!STATES.includes(kept?.state)) return null;
      return { state: kept.state, ...(typeof kept.source === "string" ? { source: kept.source } : {}) };
    } catch {
      return null;
    }
  }

  /** Written whole, so a quit mid-write leaves the last state. @param {unknown} next */
  write(next) {
    const state = /** @type {{state?: unknown, source?: unknown}} */ (next ?? {});
    if (typeof state.state !== "string" || !STATES.includes(state.state)) return Promise.reject(new Error("Unknown first-run state"));
    const kept = { state: state.state, ...(typeof state.source === "string" ? { source: state.source } : {}) };
    const written = this.#turn.then(async () => {
      const partial = `${this.file}.partial`;
      await writeFile(partial, JSON.stringify(kept));
      await rename(partial, this.file);
    });
    this.#turn = written.catch(() => undefined);
    return written;
  }
}

module.exports = { FirstRun };
