const { readFile, rename, writeFile } = require("node:fs/promises");
const { resolve, sep } = require("node:path");

// AUT-005: once a connected app brings new items in, Lore reads them through quietly.
// What to read, what came of it, the words that tell the owner, and the red number on the dock.

/** How many runs Today keeps before the oldest drops off. */
const KEPT = 5;

/** How long a contributor's name may be, as the store keeps it (lore/store.py LABEL_LIMIT). */
const LABEL_LIMIT = 200;

/** Who wrote a reading's memories, its name cut to what the store keeps, by character so an emoji is never split.
 * @param {Contributor["kind"]} kind @param {string} id @param {string} label @param {string} mark @returns {Contributor} */
const contributor = (kind, id, label, mark) => ({ kind, id, label: Array.from(label.trim()).slice(0, LABEL_LIMIT).join(""), mark });

/** @param {string} noun */
const many = (noun) => `${noun.replace(/y$/, "ie")}s`;

/** @param {number} count @param {string} noun */
const plural = (count, noun) => `${count} ${count === 1 ? noun : many(noun)}`;

/** New items from an app the catalog knows, or null: nothing new, or a built-in agent source, which the schedule reads.
 * Worded once here: what Today and the notification call it, and what its row says while it reads. One of the owner's
 * personal agents (APP-207) is called by its own name, and what it saved says it came from there. `by` is who the
 * memories it writes are put on record as from (APP-213).
 * @param {{name: string, label?: string, connector?: string | null, app?: AgentApp | null, added?: number}} read @param {SourceApp[]} apps @returns {Reading | null} */
function worthReading(read, apps) {
  const app = apps.find((candidate) => candidate.id === read.connector);
  if (!app || !read.added) return null;
  if (app.id === "agent") {
    const who = read.label || app.name;
    const by = contributor("agent", read.name, who, read.app ?? "other");
    return { name: read.name, label: who, item: app.item, added: read.added, title: `${who} saved ${plural(read.added, "thing")} to Lore`, phase: `Reading what ${who} saved`, from: who, by };
  }
  const what = `your ${app.name} ${many(app.item)}`;
  return { name: read.name, label: app.name, item: app.item, added: read.added, title: `Lore read ${what}`, phase: `Reading ${what}`, by: contributor("app", read.name, app.name, app.id) };
}

/** One of the owner's own routines, read through like an app: their sentence is all there is to call it.
 * @param {Pick<Routine, "id" | "name">} routine @param {string} ask @returns {Reading} */
function asking(routine, ask) {
  return { name: routine.id, label: routine.name, item: "", added: 0, ask, title: `“${routine.name}”`, phase: `Working on “${routine.name}”`, by: contributor("routine", routine.id, routine.name, "clock") };
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
  return { title: reading.title, read: report.read || reading.added, memories: [...memories.values()], at: new Date().toISOString(), seen: false, by: reading.by, ...(reading.from ? { from: reading.from } : {}) };
}

/** The Mac notification for a finished reading. @param {ReadyRun} run @returns {{title: string, body: string}} */
function announcement(run) {
  const selling = run.memories.filter((memory) => memory.sell).length;
  return {
    title: run.title,
    body: `${plural(run.memories.length, "new memory")}. ${selling ? `${selling} ${selling === 1 ? "looks" : "look"} worth selling.` : "They stay private on this Mac."}`
  };
}

/** Finished readings kept on disk until the owner clears them, and the dock badge that counts what they have not seen. */
class Ready {
  /** @param {string} file @param {(count: number) => void} badge */
  constructor(file, badge) {
    this.file = file;
    this.badge = badge;
  }

  /** Newest first; a missing or damaged file reads as none, and a run kept by 0.1.14 is titled as it was then. @returns {Promise<ReadyRun[]>} */
  async runs() {
    try {
      const runs = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(runs) ? runs.map((run) => (run.title ? run : { ...run, title: `Lore read your ${run.label} ${many(run.item)}` })) : [];
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

/** How many memories one report of what the owner saw may name. */
const SEEN_AT_ONCE = 500;

/** What the renderer says the owner saw, checked before it touches the file. @param {unknown} ids @returns {number[]} */
function seenIds(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > SEEN_AT_ONCE || !ids.every((id) => Number.isInteger(id) && id > 0)) throw new Error("Invalid memories");
  return ids;
}

/** APP-212: the memories the owner has had on screen, by arrival, so "New" means arrived and not yet seen, across
 * relaunches. An arrival is never reused, as an id can be. `since` is the newest arrival when Lore began keeping this,
 * so a library from before it is never all new at once. */
class Seen {
  /** Every read and write waits its turn, so two reports never drop each other's ids. @type {Promise<unknown>} */
  #turn = Promise.resolve();

  /** @param {string} file */
  constructor(file) {
    this.file = file;
  }

  /** @param {number} newest The newest arrival now: where "since" starts, the first time. @returns {Promise<SeenMemories>} */
  read(newest) {
    return this.#then(async () => (await this.#kept()) ?? this.#save({ since: newest, arrivals: [] }));
  }

  /** @param {number[]} arrivals */
  add(arrivals) {
    return this.#then(async () => {
      const kept = (await this.#kept()) ?? { since: 0, arrivals: [] };
      const all = new Set(kept.arrivals);
      for (const arrival of arrivals) if (arrival > kept.since) all.add(arrival);
      return this.#save({ since: kept.since, arrivals: [...all] });
    });
  }

  /** @template T @param {() => Promise<T>} work */
  #then(work) {
    const next = this.#turn.then(work);
    this.#turn = next.catch(() => undefined);
    return next;
  }

  /** A missing or damaged file reads as none. @returns {Promise<SeenMemories | null>} */
  async #kept() {
    try {
      const kept = JSON.parse(await readFile(this.file, "utf8"));
      return Number.isInteger(kept?.since) && Array.isArray(kept.arrivals) ? { since: kept.since, arrivals: kept.arrivals.filter(Number.isInteger) } : null;
    } catch {
      return null;
    }
  }

  /** Written beside the file, then renamed over it, like Ready's. @param {SeenMemories} seen */
  async #save(seen) {
    await writeFile(`${this.file}.tmp`, JSON.stringify(seen));
    await rename(`${this.file}.tmp`, this.file);
    return seen;
  }
}

/** The red number: memories in runs the owner has not looked at. @param {ReadyRun[]} runs */
function unseen(runs) {
  return runs.filter((run) => !run.seen).reduce((count, run) => count + run.memories.length, 0);
}

/** The dock's one red number, summed from each thing that counts toward it: new memories, a check-in waiting. */
class Badge {
  /** @type {Map<string, number>} */
  #counts = new Map();

  /** @param {(count: number) => void} set */
  constructor(set) {
    this.set = set;
  }

  /** @param {string} name @returns {(count: number) => void} */
  part(name) {
    return (count) => {
      this.#counts.set(name, count);
      this.set([...this.#counts.values()].reduce((sum, each) => sum + each, 0));
    };
  }
}

module.exports = { many, plural, worthReading, asking, landed, announcement, Ready, Badge, Seen, seenIds };
