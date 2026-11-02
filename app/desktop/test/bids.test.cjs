require("../support/scratch.cjs");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { BidWatch, announcements } = require("../src/bids.cjs");

const FIXTURES = join(__dirname, "../../../tests/fixtures/bids");
const LATER = "2099-01-01T00:00:00Z";

/** @param {string} id @param {Partial<BidMatch["bid"]>} [bid] @returns {BidMatch} */
const matched = (id, bid = {}) => ({ bid: { id, question: `Question ${id}?`, usd: 40, market: "unsorted", url: `https://yourlore.dev/b/${id}`, expires: LATER, ...bid }, memories: [{ id: 1, title: "A memory" }], score: 0.8 });

/** A watch over a board the test sets, with a matcher that answers what the test says, and a clock it moves. */
async function watching() {
  const dir = await mkdtemp(join(tmpdir(), "lore-bids-"));
  const world = { board: /** @type {{bids: Array<{id: string}>}} */ ({ bids: [] }), found: /** @type {BidMatch[]} */ ([]), now: Date.parse("2026-11-01T00:00:00Z"), badge: 0, asked: /** @type {string[]} */ ([]), down: false };
  const watch = new BidWatch({
    file: join(dir, "bid-matches.json"),
    url: "https://bids.example/bids.json",
    fetch: async (url) => {
      world.asked.push(String(url));
      if (world.down) throw new Error("offline");
      return Response.json(world.board);
    },
    match: async () => world.found,
    badge: (count) => void (world.badge = count),
    now: () => world.now
  });
  /** The next look, a minute on. */
  const look = () => {
    world.now += 61_000;
    return watch.check();
  };
  return { dir, world, watch, look, done: () => rm(dir, { recursive: true }) };
}

test("a new match is announced once, kept, and counted on the dock", async () => {
  const { world, watch, look, done } = await watching();
  try {
    world.board = { bids: [{ id: "aaaaaaaaa1" }, { id: "aaaaaaaaa2" }] };
    world.found = [matched("aaaaaaaaa1"), matched("aaaaaaaaa1")];
    assert.deepEqual((await look()).map((m) => m.bid.id), ["aaaaaaaaa1"], "one match per bid, however many came back");
    assert.deepEqual((await watch.matches()).map((m) => m.bid.id), ["aaaaaaaaa1"]);
    assert.equal(world.badge, 1);
    assert.deepEqual(await look(), [], "already announced");
    assert.deepEqual(world.asked, ["https://bids.example/bids.json", "https://bids.example/bids.json"]);
    assert.equal((await watch.find("aaaaaaaaa1"))?.bid.question, "Question aaaaaaaaa1?");
    assert.equal(await watch.find("zzzzzzzzz9"), null);
  } finally {
    await done();
  }
});

test("coming back to the app twice in a minute looks once", async () => {
  const { world, watch, look, done } = await watching();
  try {
    await look();
    world.now += 30_000;
    assert.deepEqual(await watch.check(), []);
    assert.equal(world.asked.length, 1);
  } finally {
    await done();
  }
});

test("a dismissed bid stays gone until it leaves the board, and a closed bid drops", async () => {
  const { world, watch, look, done } = await watching();
  try {
    world.board = { bids: [{ id: "aaaaaaaaa1" }, { id: "aaaaaaaaa2" }] };
    world.found = [matched("aaaaaaaaa1"), matched("aaaaaaaaa2")];
    await look();
    await watch.dismiss("aaaaaaaaa1");
    assert.deepEqual((await watch.matches()).map((m) => m.bid.id), ["aaaaaaaaa2"]);
    assert.equal(world.badge, 1);
    await look();
    assert.deepEqual((await watch.matches()).map((m) => m.bid.id), ["aaaaaaaaa2"], "dismissed survives the next look");
    // aaaaaaaaa2 is filled, so it leaves the board and the matcher no longer finds it.
    world.board = { bids: [{ id: "aaaaaaaaa1" }] };
    world.found = [matched("aaaaaaaaa1")];
    await look();
    assert.deepEqual(await watch.matches(), []);
    assert.equal(world.badge, 0);
    const kept = JSON.parse(await readFile(watch.file, "utf8"));
    assert.deepEqual(kept.dismissed, ["aaaaaaaaa1"]);
    assert.deepEqual(kept.announced, ["aaaaaaaaa1"], "what left the board is forgotten");
  } finally {
    await done();
  }
});

test("a bid whose week ran out while Lore was closed is not shown, and offline keeps what was found", async () => {
  const { world, watch, look, done } = await watching();
  try {
    world.board = { bids: [{ id: "aaaaaaaaa1" }, { id: "aaaaaaaaa2" }] };
    world.found = [matched("aaaaaaaaa1", { expires: "2026-11-02T00:00:00Z" }), matched("aaaaaaaaa2")];
    await look();
    world.now = Date.parse("2026-11-03T00:00:00Z");
    assert.deepEqual((await watch.matches()).map((m) => m.bid.id), ["aaaaaaaaa2"]);
    world.down = true;
    await assert.rejects(look(), /offline/);
    assert.deepEqual((await watch.matches()).map((m) => m.bid.id), ["aaaaaaaaa2"]);
    await watch.show();
    assert.equal(world.badge, 1);
  } finally {
    await done();
  }
});

test("a damaged file reads as nothing found, and the next look repairs it", async () => {
  const { world, watch, look, done } = await watching();
  try {
    await require("node:fs/promises").writeFile(watch.file, "{");
    assert.deepEqual(await watch.matches(), []);
    world.board = { bids: [{ id: "aaaaaaaaa1" }] };
    world.found = [matched("aaaaaaaaa1")];
    assert.equal((await look()).length, 1);
  } finally {
    await done();
  }
});

test("each match is told in plain words, and many at once in one", () => {
  const one = matched("aaaaaaaaa1", { usd: 40, question: "How do you stop reward hacking?" });
  assert.deepEqual(announcements([one]), [{ title: "Someone will pay $40 for something you know", body: "How do you stop reward hacking? · One of your memories answers it" }]);
  const three = { ...one, memories: [1, 2, 3].map((id) => ({ id, title: "m" })) };
  assert.equal(announcements([three])[0].body, "How do you stop reward hacking? · 3 memories of yours answer it");
  const many = ["a", "b", "c", "d"].map((id) => matched(`aaaaaaaaa${id}`, { usd: 12.5 }));
  assert.deepEqual(announcements(many), [{ title: "4 bids match what you know", body: "$50 on offer. Your agent can draft each answer." }]);
});

test("the CLI matches the board to the owner's memories on this Mac, and only those that answer", async () => {
  const { captureMemories, matchBids } = require("../src/state.cjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const library = JSON.parse(await readFile(join(FIXTURES, "library.json"), "utf8"));
    await captureMemories(home, library.map((/** @type {{title: string, content: string}} */ m) => ({ ...m, project: "bids" })));
    const board = JSON.parse(await readFile(join(FIXTURES, "bids.json"), "utf8"));
    const found = await matchBids(home, board);
    const answerable = board.bids.filter((/** @type {{answerable: boolean}} */ bid) => bid.answerable).map((/** @type {{id: string}} */ bid) => bid.id);
    assert.deepEqual(found.map((m) => m.bid.id).sort(), answerable.sort());
    assert.ok(found.every((m) => m.memories.length && m.memories.every((memory) => Object.keys(memory).sort().join() === "id,title")));
  } finally {
    await rm(home, { recursive: true });
  }
});
