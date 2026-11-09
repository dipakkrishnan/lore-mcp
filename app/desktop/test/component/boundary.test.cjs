// APP-063: exactly what markdown() leaves of hostile input, measured in a real Chromium DOM through
// support/markdown-probe.cjs. XC-097: split from test/unit/boundary.test.cjs; this starts Electron, so it is a component test.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

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
    const probe = join(__dirname, "../../support/markdown-probe.cjs");
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
