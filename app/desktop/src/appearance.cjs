// APP-225: light, dark, or whatever the Mac is set to, kept across launches. The window's theme follows it, so the
// page's colours and the sidebar's frosted material change together.
const { readFile, rename, writeFile } = require("node:fs/promises");

const CHOICES = ["system", "light", "dark"];

class Appearance {
  /** Every write waits its turn, so the last choice made is the one kept. @type {Promise<unknown>} */
  #turn = Promise.resolve();

  /** @param {string} file @param {{themeSource: AppearanceChoice}} theme Electron's nativeTheme */
  constructor(file, theme) {
    this.file = file;
    this.theme = theme;
  }

  /** Never chosen reads as the Mac's own; so does a missing or damaged file. @returns {Promise<AppearanceChoice>} */
  async read() {
    try {
      const kept = JSON.parse(await readFile(this.file, "utf8"))?.appearance;
      return CHOICES.includes(kept) ? kept : "system";
    } catch {
      return "system";
    }
  }

  async apply() {
    this.theme.themeSource = await this.read();
  }

  /** @param {unknown} choice */
  set(choice) {
    if (typeof choice !== "string" || !CHOICES.includes(choice)) return Promise.reject(new Error("Unknown appearance"));
    this.theme.themeSource = /** @type {AppearanceChoice} */ (choice);
    const written = this.#turn.then(async () => {
      const partial = `${this.file}.partial`;
      await writeFile(partial, JSON.stringify({ appearance: choice }));
      await rename(partial, this.file);
    });
    this.#turn = written.catch(() => undefined);
    return written;
  }
}

module.exports = { Appearance };
