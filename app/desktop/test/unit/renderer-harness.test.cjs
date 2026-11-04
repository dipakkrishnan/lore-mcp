// APP-268: the renderer loads whole in jsdom. This file proves the harness itself: renderer.js evaluates, boot() runs,
// the first load() makes the IPC calls it makes in the app, and the fake window.lore covers every member of the
// interface. It checks DOM and text only; layout stays with the walks (support/edge.cjs).
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { load, loreMembers, DEFAULT_ANSWERS } = require("../../support/renderer-harness.cjs");

/** The nine reads load() makes together, in the order renderer.js lists them. */
const LOAD_CALLS = ["snapshot", "candidates", "extras", "tasks", "sourceCatalog", "readyRuns", "checkIn", "routines", "suggestions"];

test("renderer.js loads in jsdom with boot() held back, in well under a second", () => {
  load(); // the first load in a process pays for compiling jsdom and the renderer (0.8 s to 2.6 s on a busy Mac); the budget is for the load itself
  const h = load();
  assert.equal(h.document.body.dataset.state, "loading", "boot() must not have run yet");
  assert.equal(h.lore.callsTo("agentStatus").length, 0, "the sign-in check is boot()'s first call; it must wait for boot()");
  assert.deepEqual(h.lore.names(), ["onAgentEvent", "update", "appearance"], "what renderer.js asks main at load, before boot()");
  assert.ok(h.loadMs < 1000, `loading took ${h.loadMs.toFixed(0)} ms`);
  assert.equal(typeof h.get("nextStep"), "function", "top-level functions are reachable by name");
  assert.equal(h.get("view"), "inbox", "top-level lets are reachable by name");
  assert.deepEqual(Object.keys(h.window.__lore).sort(), ["event", "load", "openTask", "preview", "show", "signIn"], "the hooks edge.cjs drives are still exposed");
});

test("boot() signs in and the first load() issues the nine reads, then marks the new memories seen", async () => {
  const h = load();
  h.boot();
  await h.idle();
  assert.equal(h.document.body.dataset.state, "app");
  assert.equal(h.document.getElementById("app").hidden, false);
  assert.equal(h.document.getElementById("welcome").hidden, true);
  const after = h.lore.names().slice(h.lore.names().indexOf("agentStatus"));
  assert.deepEqual(after.slice(0, 2), ["agentStatus", "firstRun"], "sign-in check, then where the first-run chat stands");
  assert.deepEqual(after.slice(2, 2 + LOAD_CALLS.length), LOAD_CALLS, "the first load() makes these nine calls, together, in this order");
  assert.deepEqual(after.slice(2 + LOAD_CALLS.length), ["memoriesSeen", "usage"], "then what has been seen, and that Lore was opened");
  assert.deepEqual(h.lore.callsTo("usage").map((call) => call.args), [["app.opened"]]);
  assert.equal(h.text("#title"), "Inbox", "and lands on the Inbox");
});

test("boot() with nobody signed in shows the welcome screen and says what is sent", async () => {
  const h = load();
  h.lore.answer("agentStatus", { credentials: [] });
  h.boot();
  await h.idle();
  assert.equal(h.document.body.dataset.state, "welcome");
  assert.equal(h.document.getElementById("welcome").hidden, false);
  assert.deepEqual(h.lore.callsTo("usage").map((call) => call.args[0]), ["noticed", "app.installed"], "the welcome screen remembers it said so, then counts the install");
  assert.equal(h.lore.callsTo("snapshot").length, 0, "nothing is loaded before a sign-in");
});

test("a sign-in check that fails lands on the welcome screen, not a blank window", async () => {
  const h = load();
  h.lore.answer("agentStatus", new Error("no runtime"));
  h.boot();
  await h.idle();
  assert.equal(h.document.body.dataset.state, "welcome");
});

test("a load() that fails says so and offers to try again, leaving the data alone", async () => {
  const h = load();
  h.lore.answer("snapshot", new Error("uv exploded"));
  h.boot();
  await h.idle();
  const error = h.document.querySelector("#content [role=alert]");
  assert.ok(error, "the error card carries role=alert");
  assert.match(error.textContent, /Lore could not load/);
  assert.match(error.textContent, /Your data was not changed/);
  assert.equal(error.querySelector("button")?.textContent, "Try again");
});

test("the fake window.lore has every member of the Window.lore interface, and every member renderer.js uses", () => {
  const members = loreMembers();
  const h = load();
  for (const name of members) assert.equal(typeof h.lore[name], "function", `window.lore.${name} is missing from the fake`);
  const used = new Set([...readFileSync(join(__dirname, "..", "..", "src", "renderer.js"), "utf8").matchAll(/window\.lore\.(\w+)\(/g)].map(([, name]) => name));
  for (const name of used) assert.ok(members.includes(name), `renderer.js calls window.lore.${name}, which types.d.ts does not declare`);
  for (const name of Object.keys(DEFAULT_ANSWERS)) assert.ok(members.includes(name), `the harness answers ${name}, which is no longer a member`);
});

test("the fake records calls, answers as told, and rejects with the window's own Error", async () => {
  const h = load();
  h.lore.answer("search", (query) => [{ id: "1", title: `found ${query}` }]);
  assert.deepEqual(await h.lore.search("x"), [{ id: "1", title: "found x" }]);
  assert.deepEqual(h.lore.callsTo("search"), [{ name: "search", args: ["x"] }]);
  h.lore.failNext("search", "database is locked");
  await assert.rejects(h.lore.search("y"), (error) => error instanceof h.window.Error && error.message === "database is locked");
  assert.deepEqual(await h.lore.search("z"), [{ id: "1", title: "found z" }], "after the failure, it answers as before");
  assert.equal(h.call("reason", await h.lore.search("z").then(() => new h.window.Error("Error invoking remote method 'x': Error: plain"), (e) => e), "fallback"), "plain", "the renderer's reason() sees a window Error");
});

test("agent events reach the renderer's listener", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.lore.emit({ type: "update", update: { version: "0.1.13", state: "ready" } });
  assert.equal(h.document.getElementById("update").hidden, false);
});
