// APP-063: the renderer's untrusted-text boundary. Memory bodies, drafts and agent replies are written from whatever an
// agent read, and markdown() puts them into the DOM; the CSP, the window's webPreferences and its navigation handlers
// are what hold the line around it. Each is pinned here, so a quiet loosening fails a test instead of passing review.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const read = (/** @type {string} */ name) => readFileSync(join(__dirname, "..", "src", name), "utf8");

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
  runInNewContext(`${source}\ncreateWindow();`, { BrowserWindow, shell, join, __dirname: join(__dirname, "..", "src"), pending: new Map() });
  return seen;
}

test("the main window keeps context isolation and the sandbox on and node integration off", () => {
  const { webPreferences } = mainWindow().options;
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.preload, join(__dirname, "..", "src", "preload.cjs"));
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

/** Hostile markdown and exactly what markdown() leaves of it in a real Chromium DOM. */
const RENDERED = [
  // Links: only http(s) keeps an href, and it opens outside the app.
  ["[x](javascript:alert(1))", "<p><a>x</a></p>\n"],
  ["[x](JAVASCRIPT:alert(1))", "<p><a>x</a></p>\n"],
  ["[x](java&#115;cript:alert(1))", "<p><a>x</a></p>\n"],
  ["[x](data:text/html,<b>x</b>)", "<p><a>x</a></p>\n"],
  ["[x](file:///etc/passwd)", "<p><a>x</a></p>\n"],
  ["[x](/etc/passwd)", "<p><a>x</a></p>\n"],
  ["[x][r]\n\n[r]: javascript:alert(1)", "<p><a>x</a></p>\n"],
  ["<javascript:alert(1)>", "<p><a>javascript:alert(1)</a></p>\n"],
  ["<data:text/html,x>", "<p><a>data:text/html,x</a></p>\n"],
  ["[ok](https://example.com/a)", '<p><a href="https://example.com/a" target="_blank" rel="noreferrer">ok</a></p>\n'],
  ["[ok](HTTP://example.com/b)", '<p><a href="HTTP://example.com/b" target="_blank" rel="noreferrer">ok</a></p>\n'],
  ['[x](https://e/"onmouseover=alert(1))', '<p><a href="https://e/%22onmouseover=alert(1)" target="_blank" rel="noreferrer">x</a></p>\n'],
  // Images never load, from markdown or anywhere else.
  ["![i](https://example.com/x.png)", "<p></p>\n"],
  // Raw HTML, block or inline, is dropped whole by marked's html renderer before the scrub ever sees it.
  ['<iframe src="https://example.com"></iframe>', ""],
  ['a <iframe src="https://example.com"></iframe> b', "<p>a  b</p>\n"],
  ['<object data="x.swf"></object>', "<p></p>\n"],
  ["<img src=x onerror=alert(1)>", ""],
  ["<svg onload=alert(1)></svg>", "<p></p>\n"],
  ["<script>alert(1)</script>", ""],
  ["<style>body{display:none}</style>", ""],
  ['<a href="javascript:alert(1)">raw</a>', "<p>raw</p>\n"],
  // What markdown is for still comes through.
  ["**bold** and `code`", "<p><strong>bold</strong> and <code>code</code></p>\n"]
];

test("markdown() leaves nothing of hostile input but text and http(s) links", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-markdown-"));
  const electron = require("electron");
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const inputs = join(directory, "inputs.json");
    const output = join(directory, "rendered.json");
    await writeFile(inputs, JSON.stringify(RENDERED.map(([text]) => text)));
    const probe = join(__dirname, "../support/markdown-probe.cjs");
    const result = spawnSync(electron, ["--no-sandbox", probe, inputs, output, join(directory, "user-data")], { encoding: "utf8", env, timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const rendered = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(
      RENDERED.map(([text], i) => [text, rendered[i]]),
      RENDERED
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
