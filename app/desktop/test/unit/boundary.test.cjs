// APP-063: the renderer's untrusted-text boundary. Memory bodies, drafts and agent replies are written from whatever an
// agent read, and markdown() puts them into the DOM; the CSP, the window's webPreferences and its navigation handlers
// are what hold the line around it. Each is pinned here, so a quiet loosening fails a test instead of passing review.
// XC-097: what markdown() leaves of hostile input needs a real Chromium DOM, so that one test starts Electron from
// test/component/boundary.test.cjs; the policy, window and handler checks here read the sources in process.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const read = (/** @type {string} */ name) => readFileSync(join(__dirname, "..", "..", "src", name), "utf8");

/** The CSP meta tags in index.html, each as a directive -> sources map. */
function policies() {
  const metas = [...read("index.html").matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
  return metas.map(([, content]) =>
    Object.fromEntries(
      content
        .split(";")
        .map((directive) => directive.trim().split(/\s+/))
        .filter(([name]) => name)
        .map(([name, ...sources]) => [name, sources.join(" ")])
    )
  );
}

test("index.html carries one CSP, with every directive it has today and nothing looser", () => {
  const found = policies();
  assert.equal(found.length, 1, "index.html must carry exactly one Content-Security-Policy meta tag");
  assert.deepEqual(found[0], {
    "default-src": "'self'",
    "script-src": "'self'",
    "style-src": "'self'",
    "img-src": "'self' data:",
    "connect-src": "'none'",
    "object-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'"
  });
});

test("the CSP never allows inline or eval'd script or style", () => {
  for (const [name, sources] of Object.entries(policies()[0] ?? {})) {
    assert.doesNotMatch(sources, /unsafe-inline|unsafe-eval|unsafe-hashes|wasm-unsafe-eval|\*/, `${name} is loosened: ${sources}`);
  }
});

/** main.cjs cannot be required outside Electron, so createWindow is cut out of it and run against a recording BrowserWindow. */
function mainWindow() {
  const source = read("main.cjs").match(/^function createWindow\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
  assert.ok(source, "main.cjs no longer defines function createWindow()");
  /** @type {{ options?: any, openHandler?: (details: { url: string }) => unknown, events: Record<string, Function>, opened: string[] }} */
  const seen = { events: {}, opened: [] };
  class BrowserWindow {
    /** @param {any} options */
    constructor(options) {
      seen.options = options;
      this.webContents = {
        /** @param {(details: { url: string }) => unknown} handler */
        setWindowOpenHandler: (handler) => void (seen.openHandler = handler),
        /** @param {string} name @param {Function} listener */
        on: (name, listener) => void (seen.events[name] = listener)
      };
    }
    on() {}
    loadFile() { return Promise.resolve(); }
  }
  const shell = { openExternal: async (/** @type {string} */ url) => void seen.opened.push(url) };
  runInNewContext(`${source}\ncreateWindow();`, { BrowserWindow, nativeTheme: { shouldUseDarkColors: true }, shell, join, __dirname: join(__dirname, "..", "..", "src"), pending: new Map() });
  return seen;
}

test("the main window keeps context isolation and the sandbox on and node integration off", () => {
  const { webPreferences } = mainWindow().options;
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.preload, join(__dirname, "..", "..", "src", "preload.cjs"));
});

test("the main window opens nothing in-app: http(s) goes to the system browser, everything else nowhere", () => {
  const seen = mainWindow();
  assert.ok(seen.openHandler, "createWindow no longer sets a window-open handler");
  const urls = ["https://example.com/a", "http://example.com/b", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "index.html", "lore://open"];
  // The handler runs in the vm realm; spread its answer into this one so deepEqual compares values, not prototypes.
  for (const url of urls) assert.deepEqual({ ...(/** @type {object} */ (seen.openHandler({ url }))) }, { action: "deny" }, url);
  assert.deepEqual(seen.opened, ["https://example.com/a", "http://example.com/b"]);
  let prevented = false;
  assert.ok(seen.events["will-navigate"], "createWindow no longer stops in-app navigation");
  seen.events["will-navigate"]({ preventDefault: () => void (prevented = true) });
  assert.equal(prevented, true, "will-navigate must be prevented");
});
