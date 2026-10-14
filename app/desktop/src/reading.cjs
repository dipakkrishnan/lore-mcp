const { readFile, rename, writeFile } = require("node:fs/promises");
const { resolve, sep } = require("node:path");

// AUT-005: once a connected app brings new items in, Lore reads them through quietly.
// What to read, what came of it, the words that tell the owner, and the red number on the dock.

/** How many runs Today keeps before the oldest drops off. */
const KEPT = 5;

/** @param {string} noun */
const many = (noun) => `${noun.replace(/y$/, "ie")}s`;

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${count === 1 ? noun : many(noun)}`;

/** New items from an app the catalog knows, or null: nothing new, or a built-in agent source, which the schedule reads.
 * @param {{name: string, connector?: string | null, added?: number}} read @param {SourceApp[]} apps @returns {Reading | null} */
function worthReading(read, apps) {
  const app = apps.find((candidate) => candidate.id === read.connector);
  return app && read.added ? { name: read.name, label: app.name, item: app.item, added: read.added } : null;
}

/** What a reading wrote, as the store keeps it. A file outside the memories folder, or one the store did not take, is
 * dropped, and nothing under `work/` is ever offered for sale, whatever the reading said.
 * @param {Reading} reading @param {ReadingReport} report @param {Memory[]} stored @param {string} folder @returns {ReadyRun} */
function landed(reading, report, stored, folder) {
  const work = resolve(folder, "work") + sep;
  /** @type {Map<number, ReadyMemory>} */
  const memories = new Map();
  for (const entry of report.memories) {
    const path = resolve(folder, entry.file);
    const memory = stored.find((candidate) => candidate.status === "private" && resolve(candidate.source_path) === path);
    if (!memory || !path.startsWith(folder + sep) || memories.has(memory.id)) continue;
    const kept = path.startsWith(work);
    memories.set(memory.id, { id: memory.id, title: memory.title, sell: entry.worth_selling && !kept, work: kept, why: entry.why });
  }
  return { label: reading.label, item: reading.item, read: report.read || reading.added, memories: [...memories.values()], at: new Date().toISOString(), seen: false };
}

/** The Mac notification for a finished reading. @param {ReadyRun} run @returns {{title: string, body: string}} */
function announcement(run) {
  const selling = run.memories.filter((memory) => memory.sell).length;
  return {
    title: `Lore turned ${plural(run.read, `${run.label} ${run.item}`)} into ${plural(run.memories.length, "memory")}`,
    body: selling ? `${selling} ${selling === 1 ? "looks" : "look"} worth selling.` : "They stay private on this Mac."
  };
}

/** Finished readings kept on disk until the owner clears them, and the dock badge that counts what they have not seen. */
class Ready {
  /** @param {string} file @param {(count: number) => void} badge */
  constructor(file, badge) {
    this.file = file;
    this.badge = badge;
  }

  /** Newest first; a missing or damaged file reads as none. @returns {Promise<ReadyRun[]>} */
  async runs() {
    try {
      const runs = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(runs) ? runs : [];
    } catch {
      return [];
    }
  }

  /** @param {ReadyRun} run */
  async add(run) {
    await this.#save([run, ...(await this.runs())].slice(0, KEPT));
  }

  async seen() {
    await this.#save((await this.runs()).map((run) => ({ ...run, seen: true })));
  }

  async clear() {
    await this.#save([]);
  }

  /** Put the badge back after a relaunch. */
  async show() {
    this.badge(unseen(await this.runs()));
  }

  /** Written beside the file, then renamed over it, so a crash mid-write leaves the old runs whole. @param {ReadyRun[]} runs */
  async #save(runs) {
    await writeFile(`${this.file}.tmp`, JSON.stringify(runs));
    await rename(`${this.file}.tmp`, this.file);
    this.badge(unseen(runs));
  }
}

/** The red number: memories in runs the owner has not looked at. @param {ReadyRun[]} runs */
function unseen(runs) {
  return runs.filter((run) => !run.seen).reduce((count, run) => count + run.memories.length, 0);
}

module.exports = { many, plural, worthReading, landed, announcement, Ready };
