const { readFile, rename, writeFile } = require("node:fs/promises");

// AUT-008: at the end of the day Lore may ask the owner about something it read. The model says whether to reach out;
// these rules, not the model, decide whether anything is posted. Most days nothing is.

/** The questions Lore will ask, or null to stay silent: only when the model chose to reach out, and only about
 * items Lore actually brought in today, at most three. @param {CheckInVerdict | null} verdict @param {CheckInItem[]} items
 * @returns {CheckIn | null} */
function worthAsking(verdict, items) {
  if (!verdict?.reach_out) return null;
  const today = new Map(items.map((item) => [item.id, item]));
  const questions = verdict.questions
    .filter((asked) => today.has(asked.memory) && asked.question.trim())
    .slice(0, 3)
    .map((asked) => ({ question: asked.question.trim(), memory: asked.memory, title: today.get(asked.memory)?.title ?? "" }));
  return questions.length ? { questions, why: verdict.why.trim(), at: new Date().toISOString(), state: "waiting" } : null;
}

/** One Mac notification, naming the actual thing. @param {CheckIn} checkIn */
function announcement(checkIn) {
  return { title: "Five minutes on today?", body: checkIn.questions[0].question };
}

/** The latest check-in, kept on disk: waiting for the owner, answered, or expired. Only a waiting one counts on the dock. */
class CheckIns {
  /** @param {string} file @param {(count: number) => void} badge */
  constructor(file, badge) {
    this.file = file;
    this.badge = badge;
  }

  /** @returns {Promise<CheckIn | null>} */
  async latest() {
    try {
      const checkIn = JSON.parse(await readFile(this.file, "utf8"));
      return checkIn && Array.isArray(checkIn.questions) ? checkIn : null;
    } catch {
      return null;
    }
  }

  /** The check-in waiting for the owner, if one is. */
  async waiting() {
    const checkIn = await this.latest();
    return checkIn?.state === "waiting" ? checkIn : null;
  }

  /** At most one a day. @param {Date} [now] */
  async askedToday(now = new Date()) {
    const checkIn = await this.latest();
    return Boolean(checkIn) && new Date(/** @type {CheckIn} */ (checkIn).at).toDateString() === now.toDateString();
  }

  /** Post what is worth asking, unless Lore already asked today; hands back what was posted, or null for silence.
   * @param {CheckInVerdict} verdict @param {CheckInItem[]} items */
  async consider(verdict, items) {
    const asking = worthAsking(verdict, items);
    if (!asking || (await this.askedToday())) return null;
    await this.#save(asking);
    return asking;
  }

  /** The owner's first reply: hands back what was asked, once. */
  async answer() {
    const checkIn = await this.waiting();
    if (checkIn) await this.#save({ ...checkIn, state: "answered" });
    return checkIn;
  }

  /** Not today, or the next run came first: it goes, rather than piling up. */
  async expire() {
    const checkIn = await this.waiting();
    if (checkIn) await this.#save({ ...checkIn, state: "expired" });
  }

  /** Put the badge back after a relaunch. */
  async show() {
    this.badge((await this.waiting()) ? 1 : 0);
  }

  /** @param {CheckIn} checkIn */
  async #save(checkIn) {
    await writeFile(`${this.file}.tmp`, JSON.stringify(checkIn));
    await rename(`${this.file}.tmp`, this.file);
    this.badge(checkIn.state === "waiting" ? 1 : 0);
  }
}

module.exports = { worthAsking, announcement, CheckIns };
