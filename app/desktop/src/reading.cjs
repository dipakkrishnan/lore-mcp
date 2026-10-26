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

/** What a reading wrote, as the store keeps it: what it said it wrote, and every file its runs changed, said or not.
 * A file outside the memories folder, or one the store did not take, is dropped, and nothing under `work/` is ever
 * offered for sale, whatever the reading said.
 * @param {Reading} reading @param {ReadingReport} report @param {Memory[]} stored @param {string} folder @param {string[]} [wrote] @returns {ReadyRun} */
function landed(reading, report, stored, folder, wrote = []) {
  const work = resolve(folder, "work") + sep;
  /** @type {Map<number, ReadyMemory>} */
  const memories = new Map();
  for (const entry of [...report.memories, ...wrote.map((file) => ({ file, worth_selling: false, why: "" }))]) {
    const path = resolve(folder, entry.file);
    const memory = stored.find((candidate) => candidate.status === "private" && resolve(candidate.source_path) === path);
    if (!memory || !path.startsWith(folder + sep) || memories.has(memory.id)) continue;
    const kept = path.startsWith(work);
    memories.set(memory.id, { id: memory.id, title: memory.title, sell: entry.worth_selling && !kept, work: kept, why: entry.why });
  }
  return { title: reading.title, read: report.read || reading.added, memories: [...memories.values()], at: new Date().toISOString(), seen: false, by: reading.by, ...(reading.from ? { from: reading.from } : {}) };
}

/** APP-233: what one of the owner's agents saved, for Today as soon as it is read in. The agent wrote them as memories
 * already, so no model has to read them first. @param {Reading} reading @param {Array<{id: number, title: string}>} saves @returns {ReadyRun} */
function saved(reading, saves) {
  const memories = saves.map(({ id, title }) => ({ id, title, sell: false, work: false, why: "" }));
  return { title: reading.title, read: reading.added, memories, at: new Date().toISOString(), seen: false, by: reading.by, ...(reading.from ? { from: reading.from } : {}) };
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
  /** Every change waits its turn, so a reading landing while the owner dismisses or deletes can't put back what they removed. @type {Promise<unknown>} */
  #turn = Promise.resolve();

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
  add(run) {
    return this.#change((runs) => [run, ...runs].slice(0, KEPT));
  }

  /** Add to the newest card from the same agent or app instead of putting up another, and bring it to the top. It is
   * unseen again only if it gained a memory. With none kept, it is a card of its own. @param {ReadyRun} run */
  extend(run) {
    return this.#change((runs) => {
      const kept = runs.find((each) => each.by && run.by && each.by.kind === run.by.kind && each.by.id === run.by.id);
      if (!kept) return [run, ...runs].slice(0, KEPT);
      const ids = new Set(run.memories.map((memory) => memory.id));
      const gained = run.memories.some((memory) => !kept.memories.some((had) => had.id === memory.id));
      const memories = [...kept.memories.filter((memory) => !ids.has(memory.id)), ...run.memories];
      return [{ ...kept, memories, seen: kept.seen && !gained }, ...runs.filter((each) => each !== kept)];
    });
  }

  seen() {
    return this.#change((runs) => runs.map((run) => ({ ...run, seen: true })));
  }

  clear() {
    return this.#change(() => []);
  }

  /** Drop the runs one card shows, leaving the rest. @param {unknown} keys */
  async dismiss(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > KEPT || !keys.every((key) => typeof key?.at === "string" && (key.by === null || typeof key.by === "string"))) throw new Error("Invalid memories");
    /** @param {ReadyRun} run */
    const picked = (run) => keys.some((key) => key.at === run.at && key.by === (run.by?.id ?? null));
    await this.#change((runs) => runs.filter((run) => !picked(run)));
  }

  /** Take a deleted memory off every card, and a card it leaves empty with it, so Today never opens what is gone.
   * @param {number} id */
  async forget(id) {
    await this.#change((runs) => !runs.some((run) => run.memories.some((memory) => memory.id === id)) ? runs : runs.flatMap((run) => {
      const memories = run.memories.filter((memory) => memory.id !== id);
      if (memories.length === run.memories.length) return [run];
      return memories.length ? [{ ...run, memories }] : [];
    }));
  }

  /** Put the badge back after a relaunch. */
  async show() {
    this.badge(unseen(await this.runs()));
  }

  /** Read, change and write the runs in turn; a change that hands the runs back as they were writes nothing. Written
   * beside the file, then renamed over it, so a crash mid-write leaves the old runs whole. @param {(runs: ReadyRun[]) => ReadyRun[]} change */
  #change(change) {
    const next = this.#turn.then(async () => {
      const kept = await this.runs();
      const runs = change(kept);
      if (runs === kept) return;
      await writeFile(`${this.file}.tmp`, JSON.stringify(runs));
      await rename(`${this.file}.tmp`, this.file);
      this.badge(unseen(runs));
    });
    this.#turn = next.catch(() => undefined);
    return next;
  }
}

/** APP-246: collections an automation suggests, kept until the owner reviews or dismisses each. A suggestion only ever
 * opens Lore's own picker with its memories ticked; nothing goes in a collection, or on sale, without the owner. */
class Suggestions {
  /** @type {Promise<unknown>} */
  #turn = Promise.resolve();

  /** @param {string} file */
  constructor(file) {
    this.file = file;
  }

  /** Newest first; a missing or damaged file reads as none. @returns {Promise<CollectionSuggestion[]>} */
  async list() {
    try {
      const kept = JSON.parse(await readFile(this.file, "utf8"));
      return Array.isArray(kept) ? kept : [];
    } catch {
      return [];
    }
  }

  /** A newer suggestion for the same name replaces the older. @param {CollectionSuggestion} suggestion */
  add(suggestion) {
    const same = (/** @type {CollectionSuggestion} */ each) => each.title.toLowerCase() === suggestion.title.toLowerCase();
    return this.#change((kept) => [suggestion, ...kept.filter((each) => !same(each))].slice(0, KEPT));
  }

  /** @param {unknown} at */
  async drop(at) {
    if (typeof at !== "string") throw new Error("Invalid suggestion");
    await this.#change((kept) => kept.filter((each) => each.at !== at));
  }

  /** @param {(kept: CollectionSuggestion[]) => CollectionSuggestion[]} change */
  #change(change) {
    const next = this.#turn.then(async () => {
      const kept = change(await this.list());
      await writeFile(`${this.file}.tmp`, JSON.stringify(kept));
      await rename(`${this.file}.tmp`, this.file);
    });
    this.#turn = next.catch(() => undefined);
    return next;
  }
}

/** The memories an automation's suggested collection should hold: the ids it named, and the files it named that Lore
 * keeps as private memories. @param {NonNullable<ReadingReport["collections"]>[number]} asked @param {Array<{id: number, status: string, source_path: string}>} stored @param {string} folder */
function suggested(asked, stored, folder) {
  const files = new Set((asked.files ?? []).map((file) => resolve(folder, file)));
  const named = stored.filter((memory) => memory.status === "private" && files.has(resolve(memory.source_path))).map((memory) => memory.id);
  return [...new Set([...(asked.memories ?? []), ...named])];
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

module.exports = { many, plural, worthReading, asking, landed, saved, announcement, Ready, Badge, Seen, seenIds, Suggestions, suggested };
