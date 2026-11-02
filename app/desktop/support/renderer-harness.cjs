// APP-268: the renderer loaded whole in jsdom, so its rules can be table-tested without an Electron boot.
//
// What this checks, and what it never can: a test on this harness asserts DOM structure and text (which rows a view
// draws, what they say, which buttons are hidden, which IPC calls a load makes). It never checks layout. jsdom has no
// layout engine: every box is 0×0, nothing overlaps and nothing clips, so a passing test here says nothing about how
// the view looks. The walks' LAYOUT scan (`shot()` in support/edge.cjs, under real Chromium) stays the only visual
// check, and APP-266's view-to-walk table is the record of which walk scans which view.
//
// How it loads: src/index.html goes into a jsdom window; a `marked` stub, src/markdown.js and src/renderer.js are then
// run as classic scripts in that window's own vm context, the way Chromium runs the three <script> tags, so renderer.js's
// top-level `let`s and functions are reachable from later code the same way edge.cjs reaches them with
// executeJavaScript. renderer.js's closing `boot()` call is held back; `harness.boot()` makes it. `window.lore` is a
// recorded fake generated from the `Window.lore` interface in src/types.d.ts: every member is a function that records
// its call and answers with a configurable value, so a member added to preload shows up here without a change.
//
// Usage, from a test under test/unit/:
//   const { load } = require("../../support/renderer-harness.cjs");
//   const h = load();                       // index.html + renderer.js, boot() not yet called
//   h.lore.answer("snapshot", h.emptySnapshot({ ... }));
//   h.boot(); await h.idle();               // sign-in check, enter(), first load()
//   h.call("nextStep", snapshot, state);    // any top-level function, by name
//   h.run("snapshot.node.url");             // any expression, in the renderer's own scope
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const SRC = join(__dirname, "..", "src");
/** Every window a load() has opened. pretendToBeVisual keeps a timer running in each, so a test file's process would sit
 * out the event loop for about ten seconds after its last test; they are closed once the file's tests are done. */
const opened = new Set();
let closing = false;
/** @param {string} name */
const read = (name) => readFileSync(join(SRC, name), "utf8");

/** Every member of `Window.lore`, in the order src/types.d.ts declares them (an overload counts once). @returns {string[]} */
function loreMembers() {
  const block = read("types.d.ts").match(/^interface Window \{\n\s+lore: \{\n([\s\S]*?)\n\s+\};\n\}/m)?.[1];
  if (!block) throw new Error("src/types.d.ts no longer declares `interface Window { lore: { ... } }`");
  return [...new Set([...block.matchAll(/^\s+(\w+)\(/gm)].map(([, name]) => name))];
}

/** A snapshot with nothing in it: no memories, no store, no runs. Fields passed in replace whole top-level sections.
 * @param {Partial<Snapshot>} [over] @returns {Snapshot} */
function emptySnapshot(over = {}) {
  return {
    version: 1,
    home: "/Users/owner/.lore",
    setup: { sources_configured: false, blueprint_configured: false, profile_configured: false, telemetry_enabled: true, telemetry_noticed: true, automations_noticed: true, schedule: null },
    feedback: { available: false },
    library: { counts: { private: 0 }, sources: [], items: [] },
    publications: { counts: { active: 0, revoked: 0 }, items: [] },
    collections: { items: [] },
    pricing: { publication_usd: null, answer_usd: null, answer_enabled: false, free_copies: 0 },
    node: { url: null, agents: null, selling: false, store: "unknown", live: { state: "not_configured", network: null, payout: null, price_usd: null } },
    jobs: { items: [] },
    bidMatches: [],
    ...over
  };
}

/** What each `window.lore` member answers unless a test says otherwise: the shape renderer.js expects of it, and nothing
 * in it. Members not named here answer `undefined`. @type {Record<string, unknown>} */
const DEFAULT_ANSWERS = {
  snapshot: () => emptySnapshot(),
  agentStatus: () => ({ credentials: [{ providerId: "anthropic", type: "oauth" }] }),
  history: () => [],
  tasks: () => [],
  search: () => [],
  gists: () => ({}),
  suggestions: () => [],
  candidates: () => [],
  extras: () => [],
  approveExtras: () => true,
  push: () => true,
  revealHome: () => "/Users/owner/.lore",
  usageLog: () => "",
  sales: () => [],
  views: () => ({}),
  listStore: () => ({ state: "none" }),
  listingStatus: () => ({ state: "none" }),
  cardStatus: () => ({ account: "", pending: "", ready: null, minimum_usd: 0.5 }),
  pickFiles: () => [],
  pickFolder: () => null,
  sourceCatalog: () => [],
  sourceChoices: () => [],
  readSource: () => [],
  agents: () => [],
  agentAddress: () => ({ mcp_url: "https://store.example/mcp" }),
  agentApps: () => [],
  // An owner past the first-run chat: Today draws as itself. A test of that chat answers `null` or `started` instead.
  firstRun: () => ({ state: "skipped" }),
  appearance: () => "system",
  readyRuns: () => [],
  memoriesSeen: () => ({ since: 0, arrivals: [] }),
  checkIn: () => null,
  routines: () => [],
  microphone: () => false,
  transcribe: () => "",
  update: () => ({ version: "0.0.0-test", state: "current" })
};

/**
 * The fake `window.lore`: one recording function per interface member.
 * @param {string[]} members @param {vm.Context} context The window's own realm, so a rejection is one of its Errors.
 */
function fakeLore(members, context) {
  /** @type {Array<{name: string, args: unknown[]}>} */
  const calls = [];
  /** @type {Map<string, unknown>} */
  const answers = new Map(Object.entries(DEFAULT_ANSWERS));
  /** @type {Set<(event: AgentEvent) => void>} */
  const listeners = new Set();
  const ContextError = /** @type {ErrorConstructor} */ (vm.runInContext("Error", context));
  /** @param {string} name @param {unknown[]} args */
  const answer = (name, args) => {
    const kept = answers.get(name);
    return typeof kept === "function" ? kept(...args) : kept;
  };
  const lore = /** @type {Record<string, Function> & typeof controls} */ ({});
  for (const name of members) {
    if (name === "onAgentEvent") lore[name] = (/** @type {(event: AgentEvent) => void} */ listener) => { calls.push({ name, args: [listener] }); listeners.add(listener); return () => listeners.delete(listener); };
    else if (name === "pathFor") lore[name] = (/** @type {File} */ file) => { calls.push({ name, args: [file] }); return `/Users/owner/Desktop/${file.name}`; };
    else lore[name] = (/** @type {unknown[]} */ ...args) => {
      calls.push({ name, args });
      try {
        const value = answer(name, args);
        return value instanceof Error || value instanceof ContextError ? Promise.reject(new ContextError(value.message)) : Promise.resolve(value);
      } catch (error) {
        return Promise.reject(new ContextError(error instanceof Error ? error.message : String(error)));
      }
    };
  }
  const controls = {
    /** Every call made so far, oldest first. */
    calls,
    /** The names of every call made so far. */
    names: () => calls.map((call) => call.name),
    /** The calls to one member. @param {string} name */
    callsTo: (name) => calls.filter((call) => call.name === name),
    /** Forget the calls made so far. */
    reset: () => void calls.splice(0),
    /** What `name` answers from now on: a value, a function of the call's arguments, or an Error to reject with.
     * @param {string} name @param {unknown} value */
    answer: (name, value) => void answers.set(name, value),
    /** `name` rejects its next `times` calls with `message`, then answers as before. @param {string} name @param {string} message */
    failNext: (name, message = `${name} failed`, times = 1) => {
      const before = answers.get(name);
      answers.set(name, (/** @type {unknown[]} */ ...args) => {
        if (times-- > 0) return new ContextError(message);
        answers.set(name, before);
        return typeof before === "function" ? before(...args) : before;
      });
    },
    /** Deliver an agent event to the renderer, as main would over IPC. @param {AgentEvent} event */
    emit: (event) => { for (const listener of listeners) listener(event); }
  };
  Object.assign(lore, controls);
  return lore;
}

/** What jsdom lacks that renderer.js reaches at load or in the rules under test, stubbed to the least that keeps the DOM
 * honest. Dictation (AudioContext, getUserMedia) is left out on purpose. @param {import("jsdom").DOMWindow} window */
function stubPlatform(window) {
  const { HTMLElement, HTMLDialogElement, Element, document } = window;
  // <dialog>: `open` is the attribute the renderer and its tests read; close fires the event the sheets remove on.
  const dialog = HTMLDialogElement.prototype;
  dialog.show = function () { this.setAttribute("open", ""); };
  dialog.showModal = function () { this.setAttribute("open", ""); };
  dialog.close = function (/** @type {string} */ returnValue) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    if (returnValue !== undefined) this.returnValue = returnValue;
    this.dispatchEvent(new window.Event("close"));
  };
  // Popovers: shown or hidden by a `data-popover-open` mark, with the toggle event the account menu listens for.
  const toggle = (/** @type {HTMLElement} */ node, /** @type {boolean} */ open) => {
    const was = node.hasAttribute("data-popover-open");
    if (was === open) return;
    node.toggleAttribute("data-popover-open", open);
    const event = new window.Event("toggle");
    Object.assign(event, { oldState: was ? "open" : "closed", newState: open ? "open" : "closed" });
    node.dispatchEvent(event);
  };
  // jsdom's own sheet hides a [popover] until it is :popover-open, which it never is here, and it will not focus inside
  // a display:none element: an author rule (jsdom's cascade ignores origin, so it is !important) shows it for as long as the mark says it is open.
  const shown = document.createElement("style");
  shown.textContent = "[popover][data-popover-open] { display: block !important; }";
  document.head.append(shown);
  HTMLElement.prototype.showPopover = function () { toggle(this, true); };
  HTMLElement.prototype.hidePopover = function () { toggle(this, false); };
  HTMLElement.prototype.togglePopover = function (/** @type {boolean} */ force) { toggle(this, force ?? !this.hasAttribute("data-popover-open")); return this.hasAttribute("data-popover-open"); };
  // A button with popovertarget opens its popover, as the account button does in the app.
  document.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("button[popovertarget]") : null;
    const target = button && document.getElementById(/** @type {string} */ (button.getAttribute("popovertarget")));
    if (target) toggle(target, !target.hasAttribute("data-popover-open"));
  });
  Element.prototype.scrollIntoView = function () {};
  Element.prototype.getAnimations = function () { return []; };
  Element.prototype.animate = function () { return { finished: Promise.resolve(), cancel() {}, finish() {} }; };
  window.matchMedia = (/** @type {string} */ query) => {
    const dark = query.includes("prefers-color-scheme: dark") && window.__harness.dark;
    return { matches: dark, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false };
  };
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  window.ResizeObserver = Observer;
  window.IntersectionObserver = Observer;
  // A focused, visible window: the renderer marks what the owner can see as seen.
  document.hasFocus = () => window.__harness.focused;
}

/** A value the window built, rebuilt in this realm: plain objects and arrays from the window's vm context carry that
 * realm's prototypes, which `assert.deepStrictEqual` refuses to match against a literal written in a test. Anything else
 * (DOM nodes, functions, Errors, Dates) is left as it is. @param {unknown} value @returns {unknown} */
function plain(value) {
  if (Array.isArray(value)) return Array.from(value, plain);
  if (value === null || typeof value !== "object" || Object.prototype.toString.call(value) !== "[object Object]") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && Object.getPrototypeOf(proto) !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
}

/**
 * index.html, a marked stub, markdown.js and renderer.js in one jsdom window, with `boot()` not yet called.
 * @param {{ dark?: boolean, focused?: boolean, answers?: Record<string, unknown> }} [options] `dark`: what the Mac's appearance
 * query answers. `answers`: what `window.lore` members answer from the start, for the ones renderer.js asks at load, before
 * a test could set them.
 */
function load({ dark = false, focused = true, answers = {} } = {}) {
  const started = performance.now();
  const dom = new JSDOM(read("index.html"), { url: "http://lore.local/index.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  opened.add(window);
  if (!closing && process.env.NODE_TEST_CONTEXT) {
    closing = true;
    require("node:test").after(() => { for (const open of opened) open.close(); opened.clear(); });
  }
  window.__harness = { dark, focused };
  stubPlatform(window);
  const context = dom.getInternalVMContext();
  /** @param {string} code @param {string} filename */
  const run = (code, filename = "harness.js") => vm.runInContext(code, context, { filename });
  const lore = fakeLore(loreMembers(), context);
  for (const [name, value] of Object.entries(answers)) lore.answer(name, value);
  window.lore = lore;
  // marked, as markdown.js uses it: text in paragraphs, nothing parsed. The real library's output is pinned by
  // test/boundary.test.cjs under real Chromium; here the DOM only needs the text to land.
  run(`var marked = { use() {}, parse(text) { return text.split(/\\n{2,}/).map((p) => "<p>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>").join("\\n"); } };`, "marked-stub.js");
  run(read("markdown.js"), "markdown.js");
  const renderer = read("renderer.js");
  if (!renderer.endsWith("\nboot();\n")) throw new Error("renderer.js no longer ends with `boot();`; the harness holds that call back and must know where it is");
  run(renderer.slice(0, -"boot();\n".length), "renderer.js");
  const loadMs = performance.now() - started;

  const harness = {
    window,
    document: window.document,
    lore,
    /** How long index.html and the scripts took to load, in milliseconds. */
    loadMs,
    emptySnapshot,
    run,
    /** A top-level binding of renderer.js, by name. @param {string} name */
    get: (name) => run(name),
    /** Assign a top-level `let` of renderer.js. @param {string} name @param {unknown} value */
    set: (name, value) => { window.__harness.value = value; run(`${name} = window.__harness.value; delete window.__harness.value;`); },
    /** Call a top-level function of renderer.js; plain data it returns is rebuilt in this realm. @param {string} name @param {...unknown} args */
    call: (name, ...args) => plain(run(name)(...args)),
    /** What renderer.js does last: the sign-in check, then enter(). */
    boot: () => run("boot()"),
    /** Signed in as the walks do it, with the first load() under way. */
    signIn: () => run("window.__lore.signIn()"),
    /** Let every promise and timer already due settle. */
    idle: async (rounds = 25) => { for (let i = 0; i < rounds; i++) await new Promise((done) => setImmediate(done)); },
    /** The text of the first node matching `selector`, "" when there is none. @param {string} selector */
    text: (selector) => window.document.querySelector(selector)?.textContent ?? "",
    /** Every node matching `selector`. @param {string} selector */
    all: (selector) => [...window.document.querySelectorAll(selector)],
    close: () => window.close()
  };
  return harness;
}

module.exports = { load, loreMembers, emptySnapshot, DEFAULT_ANSWERS };
