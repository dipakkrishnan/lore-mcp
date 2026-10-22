// AUT-006: while Lore is open it keeps the owner's routines itself. The CLI says what is due and when the
// next one is; this only watches the clock, so a run missed while Lore was closed happens once on launch.

/** The longest Lore goes without looking at the clock, so a Mac that slept or crossed a time zone is noticed within the hour. */
const LOOK_EVERY_MS = 60 * 60_000;

class Schedule {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #timer;
  /** @type {Promise<void> | null} */
  #checking = null;
  /** The run under way, whether the clock or the owner asked for it; the next waits for it. @type {Promise<unknown>} */
  #running = Promise.resolve();

  /** @param {() => Promise<Routine[]>} list @param {(routine: Routine) => Promise<void>} run @param {() => number} [now] */
  constructor(list, run, now = Date.now) {
    this.list = list;
    this.run = run;
    this.now = now;
  }

  /** Run what is due, one at a time, then wait for the next hour any routine names. */
  check() {
    this.#checking ??= this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  /** Run one routine after any run under way. @param {Routine} routine */
  runNow(routine) {
    const turn = this.#running.then(() => this.run(routine));
    this.#running = turn.catch(() => {});
    return turn;
  }

  stop() {
    clearTimeout(this.#timer);
  }

  async #check() {
    this.stop();
    let wait = LOOK_EVERY_MS;
    try {
      let routines = await this.list();
      const due = routines.filter((routine) => routine.due);
      for (const routine of due) await this.runNow(routine).catch((error) => console.error(error));
      if (due.length) routines = await this.list();
      const next = Math.min(...routines.map((routine) => Date.parse(routine.next_run)).filter(Number.isFinite));
      wait = Math.max(1000, Math.min(LOOK_EVERY_MS, next - this.now()));
    } catch (error) {
      console.error(error);
    }
    this.#timer = setTimeout(() => void this.check(), wait);
  }
}

module.exports = { Schedule, LOOK_EVERY_MS };
