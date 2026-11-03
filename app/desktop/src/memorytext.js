// APP-284: a memory's text the way its sheet reads it. The title shows once, and an agent's bookkeeping (Codex's
// scope, applies_to, rollout files and keywords) becomes properties, a quiet line, or nothing. Display only: what's
// stored, drafted or sold never changes. Its own script, loaded before renderer.js, so test/memorytext.test.cjs runs it
// without a window.

/** @typedef {{ markdown: string } | { keywords: string }} MemoryPart */

class MemoryText {
  /** Lines only an agent's own memory format writes; a memory without one renders as it always has. */
  static AGENT = /^\s*(?:#{1,6}\s+rollout_summary_files?\s*$|(?:applies_to|rollout_path|rollout_summary_files?|thread_id)\s*[:=])/im;
  static FIELD = /^\s*(scope|applies_to|updated_at|cwd|rollout_path|rollout_summary_files?|thread_id|keywords)\s*:\s*(.*)$/i;
  static HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  static FENCE = /^\s{0,3}(```|~~~)/;

  /** @param {string} title @param {string} text The body, frontmatter already removed. */
  constructor(title, text) {
    this.title = title;
    this.text = text;
    /** @type {MemoryPart[]} */
    this.parts = [];
    this.scope = "";
    this.project = "";
    this.located = false;
    /** @type {string | null} */
    this.updated = null;
  }

  /** @param {string} text */
  static plain(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }

  read() {
    const text = this.untitled();
    if (!MemoryText.AGENT.test(text)) {
      this.parts = [{ markdown: text }];
      return this;
    }
    /** @type {string[]} */
    let chunk = [];
    /** @type {"files" | "keywords" | null} */
    let section = null;
    /** @type {string[]} */
    let words = [];
    let fenced = false;
    const flush = () => {
      const markdown = chunk.join("\n").replace(/^\n+|\s+$/g, "");
      if (markdown) this.parts.push({ markdown });
      chunk = [];
    };
    const quiet = (/** @type {string} */ keywords) => {
      if (!keywords) return;
      flush();
      this.parts.push({ keywords });
    };
    const close = () => {
      if (section === "keywords") quiet(words.join(", "));
      section = null;
      words = [];
    };
    for (const line of text.split("\n")) {
      if (fenced || MemoryText.FENCE.test(line)) {
        if (MemoryText.FENCE.test(line)) fenced = !fenced;
        if (!section) chunk.push(line);
        continue;
      }
      const heading = MemoryText.HEADING.exec(line);
      if (heading) {
        close();
        const name = heading[2].trim().toLowerCase();
        if (/^rollout_summary_files?$/.test(name)) section = "files";
        else if (name === "keywords") section = "keywords";
        else chunk.push(line);
        continue;
      }
      if (section === "files") {
        for (const match of line.matchAll(/updated_at=([^,;\s)]+)/g)) this.seen(match[1]);
        continue;
      }
      if (section === "keywords") {
        const word = line.replace(/^\s*[-*+]\s+/, "").trim();
        if (word) words.push(word);
        continue;
      }
      const field = MemoryText.FIELD.exec(line);
      if (!field) {
        chunk.push(line);
        continue;
      }
      const [, key, value] = field;
      const name = key.toLowerCase();
      if (name === "scope") {
        // The first scope describes the memory; a later one heads its own group, so it stays as a plain line.
        if (this.scope) chunk.push(value.trim(), "");
        else this.scope = value.trim();
      } else if (name === "applies_to") this.locate(/cwd=([^;\s]+)/.exec(value)?.[1]);
      else if (name === "cwd") this.locate(value.trim());
      else if (name === "updated_at") this.seen(value.trim());
      else if (name === "keywords") quiet(value.trim());
    }
    close();
    flush();
    return this;
  }

  /** The body without a leading heading that repeats the title. */
  untitled() {
    const lines = this.text.split("\n");
    const first = lines.findIndex((line) => line.trim());
    const heading = first < 0 ? null : MemoryText.HEADING.exec(lines[first]);
    if (!heading || MemoryText.plain(heading[2]) !== MemoryText.plain(this.title)) return this.text;
    return lines.slice(first + 1).join("\n").replace(/^\s*\n/, "");
  }

  /** The project is the folder the memory's first group was worked in; a later group names its own. A Codex chat's
   * scratch folder (~/Documents/Codex/<date>/<slug>) isn't a project. @param {string | undefined} path */
  locate(path) {
    if (this.located || !path) return;
    this.located = true;
    const folder = path.replace(/[,;.]+$/, "").replace(/[/\\]+$/, "");
    if (/[/\\]Codex[/\\](?:\d{4}-\d{2}-\d{2}|\*)[/\\]/.test(folder)) return;
    this.project = folder.split(/[/\\]/).pop() ?? "";
  }

  /** @param {string} iso */
  seen(iso) {
    if (Number.isNaN(Date.parse(iso))) return;
    if (!this.updated || Date.parse(iso) > Date.parse(this.updated)) this.updated = iso;
  }
}

if (typeof module === "object") module.exports = { MemoryText };
