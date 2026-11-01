// APP-064: the renderer, preload and main agree on every IPC channel and window.lore member, so a channel
// exposed with no handler (APP-039's agent:status) or a handler nobody can reach fails here, not in a console.
// main.cjs cannot be required outside Electron, so channels are read as text; preload runs against a stub Electron.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const read = (/** @type {string} */ name) => readFileSync(join(__dirname, "..", "src", name), "utf8");

/** @param {string} source @param {RegExp} pattern */
const all = (source, pattern) => [...source.matchAll(pattern)].map((m) => m[1]);
/** @param {Set<string>} from @param {Set<string>} to */
const missing = (from, to) => [...from].filter((name) => !to.has(name)).sort();

/** @param {string} preload */
const invoked = (preload) => new Set(all(preload, /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g));
/** @param {string} main */
const handled = (main) => new Set(all(main, /ipcMain\.handle\(\s*["']([^"']+)["']/g));
/** Electron throws on a second ipcMain.handle for one channel, at launch.
 * @param {string} main */
const twice = (main) => all(main, /ipcMain\.handle\(\s*["']([^"']+)["']/g).filter((name, i, names) => names.indexOf(name) !== i);
/** The members preload hands to exposeInMainWorld("lore", ...).
 * @param {string} preload */
const exposed = (preload) => {
  /** @type {Record<string, unknown> | undefined} */
  let lore;
  const contextBridge = {
    exposeInMainWorld: (/** @type {string} */ key, /** @type {Record<string, unknown>} */ api) => void (key === "lore" && (lore = api))
  };
  const electron = { contextBridge, ipcRenderer: {}, webUtils: {} };
  runInNewContext(preload, { require: (/** @type {string} */ name) => (name === "electron" ? electron : require(name)) });
  assert.ok(lore, 'preload.cjs no longer calls exposeInMainWorld("lore", ...)');
  return new Set(Object.keys(lore));
};
/** Member access, not calls: the renderer also passes members like window.lore.push as references.
 * @param {string} renderer */
const referenced = (renderer) => new Set(all(renderer, /window\.lore\??\.([A-Za-z_$][\w$]*)/g));
/** Any other use of window.lore (bracket access, destructuring, an alias) would hide members from the scan.
 * @param {string} renderer */
const unreadable = (renderer) => all(renderer, /(window\.lore(?!\??\.[A-Za-z_$]).{0,20})/g);

test("every channel preload invokes has a handler in main", () => {
  const channels = invoked(read("preload.cjs"));
  assert.ok(channels.size > 0, "found no ipcRenderer.invoke channels in preload.cjs");
  assert.deepEqual(missing(channels, handled(read("main.cjs"))), [], "preload.cjs invokes channels main.cjs never handles");
});

test("every handler main registers is reachable from preload, and registered once", () => {
  const main = read("main.cjs");
  const handlers = handled(main);
  assert.ok(handlers.size > 0, "found no ipcMain.handle channels in main.cjs");
  assert.deepEqual(missing(handlers, invoked(read("preload.cjs"))), [], "main.cjs handles channels preload.cjs never invokes");
  assert.deepEqual(twice(main), [], "main.cjs handles a channel twice");
});

test("every window.lore member the renderer uses is one preload exposes", () => {
  const renderer = read("renderer.js");
  const members = referenced(renderer);
  assert.ok(members.size > 0, "found no window.lore members in renderer.js");
  assert.deepEqual(unreadable(renderer), [], "renderer.js reaches window.lore in a way this test cannot read; use window.lore.<member>");
  assert.deepEqual(missing(members, exposed(read("preload.cjs"))), [], "renderer.js uses window.lore members preload.cjs never exposes");
});

test("the contract checks catch each kind of drift they exist for", () => {
  const preload = `const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("lore", {
  /** @param {string} id */
  status: () => ipcRenderer.invoke("agent:status"),
  push: () => ipcRenderer.invoke('store:push'),
  onEvent: (listener) => {
    const handler = (_event, value) => listener({ nested: value });
    ipcRenderer.on("agent:event", handler);
  }
});`;
  const main = `ipcMain.handle("store:push", () => undefined);\nipcMain.handle("store:orphan", () => undefined);\nipcMain.handle("store:orphan", () => 1);`;
  assert.deepEqual(missing(invoked(preload), handled(main)), ["agent:status"], "a preload channel with no handler");
  assert.deepEqual(missing(handled(main), invoked(preload)), ["store:orphan"], "a handler with no preload channel");
  assert.deepEqual(twice(main), ["store:orphan"], "a channel handled twice");
  assert.deepEqual([...exposed(preload)].sort(), ["onEvent", "push", "status"], "nested keys and comments are not members");
  const renderer = `button.onclick = window.lore.push;\nawait window.lore?.status();\nconst off = window.lore.pull;\nwindow.lore.onEvent(() => {});`;
  assert.deepEqual(unreadable(renderer), []);
  assert.deepEqual(missing(referenced(renderer), exposed(preload)), ["pull"], "a member passed as a reference, not called");
  assert.deepEqual(unreadable(`const { pull } = window.lore;\nwindow.lore["push"]();`), ["window.lore;", 'window.lore["push"]();']);
});
