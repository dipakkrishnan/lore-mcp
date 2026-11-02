import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { board } from "../src/bid-board.js";
import { callbackAllowed } from "../src/bid-callback.js";
import { readAnswer, readBid } from "../src/bid-input.js";
import { BidBook, HOURLY_CAP, LIFETIME_MS, statusOf } from "../src/bids.js";
import worker from "../src/worker.js";

const REGISTRY = { markets: [{ id: "rl-evals", name: "RL evals", tab: "AI" }], sellers: [] };
const QUESTION = "How do you stop reward hacking on long coding tasks?";
const EMAIL = "buyer-secret@example.com";
const CALLBACK = "https://agent.example.com/hooks/secret-callback";
const ANSWER = { handle: "dipak", piece_url: "https://dipak.example.com/p/aaaaaaaaaaaaaaaaaaaaaaaa", preview: "Pin the grader first.", usd: 20 };
const ADMIN = { authorization: "Bearer test-admin-token" };
const pass = () => ({ limit: vi.fn(async () => ({ success: true })) });
const block = () => ({ limit: vi.fn(async () => ({ success: false })) });
const book = () => env.BIDS.get(env.BIDS.idFromName("book"));

let outbound;
beforeEach(async () => {
  outbound = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("lore-marketplace")) return Response.json(REGISTRY);
    outbound.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  });
  await runInDurableObject(book(), (_instance, state) => state.storage.sql.exec("DELETE FROM bid_events; DELETE FROM bids; DELETE FROM meta"));
});
afterEach(() => vi.restoreAllMocks());

async function call(path, init = {}, extra = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://yourlore.dev${path}`, { redirect: "manual", ...init }), { ...env, BID_RATE_LIMIT: pass(), BID_GLOBAL_RATE_LIMIT: pass(), ...extra }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}
const sendJson = (path, method, body, headers = {}, extra) => call(path, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }, extra);
const place = (fields = {}, extra) => sendJson("/bids", "POST", { question: QUESTION, usd: 20, market: "rl-evals", ...fields }, {}, extra);
const placeForm = (fields = {}, extra) =>
  call("/bids", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ question: QUESTION, usd: "20", market: "rl-evals", ...fields }) }, extra);
const answer = (id, fields = ANSWER, headers = ADMIN) => sendJson(`/b/${id}/answers`, "POST", fields, headers);
const placed = async (fields) => (await (await place(fields)).json()).id;

describe("placing a bid", () => {
  test("a JSON post gets an id, a page and a status address, open for 7 days", async () => {
    const response = await place();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["expires", "id", "status_url", "url"]);
    expect(body.id).toMatch(/^[a-z0-9]{10}$/);
    expect(body.url).toBe(`https://yourlore.dev/b/${body.id}`);
    expect(body.status_url).toBe(`https://yourlore.dev/b/${body.id}.json`);
    const bid = await (await call(`/b/${body.id}.json`)).json();
    expect(bid).toMatchObject({ id: body.id, question: QUESTION, usd: 20, market: "rl-evals", status: "open", answers: [], events: [{ type: "opened" }] });
    expect(Date.parse(bid.expires) - Date.parse(bid.created)).toBe(LIFETIME_MS);
    expect(bid.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  test("a form post, with no script, lands on the bid's own page", async () => {
    const response = await placeForm();
    expect(response.status).toBe(303);
    const [, id] = response.headers.get("location").match(/\/b\/([a-z0-9]{10})$/);
    const html = await (await call(`/b/${id}`)).text();
    expect(html).toContain(`<title>${QUESTION}</title>`);
    expect(html).toContain(`<h1>${QUESTION}</h1>`);
    expect(html).toContain(`<link rel="alternate" type="application/json" href="/b/${id}.json">`);
    expect(html).toContain("<b>$20</b>offered");
    expect(html).toContain('<a href="/marketplace/rl-evals">RL evals</a>');
    expect(html).toContain("<b>7 days</b>left");
  });

  test("the /bids page carries a form that posts without a script", async () => {
    const html = await (await call("/bids")).text();
    expect(html).toMatch(/<form class="bid-form" method="post" action="\/bids">/);
    expect(html).toContain('<option value="rl-evals">RL evals</option>');
    expect(html).toContain("You pay only if you accept an answer. If nobody answers in 7 days, the bid ends.");
    expect(html).not.toContain('name="email"');
  });

  test("an unknown or missing market files under unsorted", async () => {
    for (const market of ["no-such-market", "", undefined]) {
      const id = await placed({ market });
      expect((await (await call(`/b/${id}.json`)).json()).market).toBe("unsorted");
    }
  });

  test("a JSON mistake gets a 400 with one plain sentence", async () => {
    const response = await place({ usd: 4 });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Bids are $5 to $1,000." });
    const broken = await call("/bids", { method: "POST", headers: { "content-type": "application/json" }, body: "[1," });
    expect(broken.status).toBe(400);
  });

  test("a form mistake shows the form again with the message and what was typed", async () => {
    const response = await placeForm({ question: "Too <b>", usd: "20" });
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('<p class="error" role="alert">Write a question of at least 10 characters.</p>');
    expect(html).toContain("Too &lt;b&gt;</textarea>");
    expect((await (await call("/bids.json")).json()).bids).toEqual([]);
  });

  test("escapes the question wherever it is drawn", async () => {
    const id = await placed({ question: "<script>alert(1)</script> is this safe?" });
    const html = (await (await call(`/b/${id}`)).text()) + (await (await call("/bids")).text());
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("validation", () => {
  const markets = new Set(["rl-evals"]);
  const check = (fields) => readBid({ question: QUESTION, usd: "20", ...fields }, markets);

  test.each([
    [{ question: "short" }, "Write a question of at least 10 characters."],
    [{ question: "   " }, "Write a question of at least 10 characters."],
    [{ question: "x".repeat(281) }, "Keep the question to 280 characters or fewer."],
    [{ usd: "4" }, "Bids are $5 to $1,000."],
    [{ usd: "1001" }, "Bids are $5 to $1,000."],
    [{ usd: "" }, "Bids are $5 to $1,000."],
    [{ usd: "-10" }, "Bids are $5 to $1,000."],
    [{ usd: "twenty" }, "Bids are $5 to $1,000."],
    [{ usd: "20.50" }, "Write the amount in whole dollars, like 20."],
    [{ email: "not-an-email" }, "That email address doesn't look right."],
    [{ callback_url: "http://agent.example.com/hook" }, "The callback address has to start with https://."],
    [{ callback_url: "https://relay.yourlore.dev/hook" }, "The callback address can't be on yourlore.dev."],
    [{ callback_url: "https://YourLore.dev./b/x" }, "The callback address can't be on yourlore.dev."]
  ])("%j is refused", (fields, error) => {
    expect(check(fields)).toEqual({ error });
  });

  test("accepts dollar signs and commas, trims, and keeps contact details apart", () => {
    expect(check({ question: `  ${QUESTION}\n`, usd: "$1,000", email: EMAIL, callback_url: CALLBACK, market: "rl-evals" })).toEqual({
      value: { question: QUESTION, usd_cents: 100000, market: "rl-evals", email: EMAIL, callback_url: CALLBACK }
    });
    expect(check({ usd: 5 }).value.usd_cents).toBe(500);
    expect(check({ question: { toString: () => QUESTION } }).error).toBe("Write a question of at least 10 characters.");
  });

  test.each([
    [{ handle: "" }, "Give the seller's handle, like dipak."],
    [{ piece_url: "javascript:alert(1)" }, "The piece's address has to start with https://."],
    [{ preview: "" }, "Add the first lines of the answer."],
    [{ preview: "x".repeat(501) }, "Keep the preview to 500 characters or fewer."],
    [{ usd: 0 }, "Answers are $1 to $1,000."]
  ])("answer %j is refused", (fields, error) => {
    expect(readAnswer({ ...ANSWER, ...fields })).toEqual({ error });
  });

  test("callbacks go only to https addresses off yourlore.dev", () => {
    expect(callbackAllowed(CALLBACK)).toBe(true);
    for (const bad of ["http://agent.example.com", "https://yourlore.dev/bids", "https://www.yourlore.dev", "https://x.YOURLORE.DEV", "not a url"]) expect(callbackAllowed(bad)).toBe(false);
    expect(callbackAllowed("https://notyourlore.dev/hook")).toBe(true);
  });
});

describe("status", () => {
  const bid = { expires: "2026-11-07T22:10:00Z" };
  const before = Date.parse("2026-11-01T00:00:00Z");
  const after = Date.parse("2026-11-08T00:00:00Z");
  const events = (...types) => types.map((type) => ({ type }));

  test("is read from the events and the clock, in the contract's order", () => {
    expect(statusOf(bid, events("opened"), before)).toBe("open");
    expect(statusOf(bid, events("opened", "answered"), before)).toBe("answered");
    expect(statusOf(bid, events("opened", "answered"), after)).toBe("expired");
    expect(statusOf(bid, events("opened", "expired"), before)).toBe("expired");
    expect(statusOf(bid, events("opened", "answered", "filled"), after)).toBe("filled");
    expect(statusOf(bid, events("opened", "filled", "removed"), before)).toBe("removed");
  });

  test("a week-old bid ends, records it, leaves the board, and takes no answers", async () => {
    const old = Date.now() - LIFETIME_MS - 60_000;
    const { bid } = await book().place({ question: QUESTION, usd_cents: 2000, market: "rl-evals" }, old);
    const shape = await (await call(`/b/${bid.id}.json`)).json();
    expect(shape.status).toBe("expired");
    expect(shape.events.map((e) => e.type)).toEqual(["opened", "expired"]);
    expect((await (await call("/bids.json")).json()).bids).toEqual([]);
    expect((await answer(bid.id)).status).toBe(409);
    await call(`/b/${bid.id}.json`);
    expect((await (await call(`/b/${bid.id}.json`)).json()).events).toHaveLength(2);
  });

  test("counts bids that were answered and then left to end", async () => {
    const old = Date.now() - LIFETIME_MS - 60_000;
    const { bid } = await book().place({ question: QUESTION, usd_cents: 2000, market: "rl-evals" }, old);
    await book().answer(bid.id, { ...ANSWER, usd_cents: 2000 }, old + 1000);
    await placed();
    const list = await (await call("/bids.json")).json();
    expect(list.walked_away).toBe(1);
    expect(list.bids).toHaveLength(1);
  });

  test("/bids.json lists live bids newest first, readable from any origin", async () => {
    const first = await placed({ question: "The first question asked here?" });
    const second = await placed();
    const response = await call("/bids.json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect((await response.json()).bids.map((b) => b.id)).toEqual([second, first]);
  });
});

describe("privacy", () => {
  test("email and callback_url never appear in any response", async () => {
    const make = await place({ email: EMAIL, callback_url: CALLBACK });
    const madeText = await make.text();
    const { id } = JSON.parse(madeText);
    const form = await placeForm({ email: EMAIL, callback_url: CALLBACK });
    const responses = [
      madeText,
      JSON.stringify([...form.headers]),
      await (await answer(id)).text(),
      await (await call(`/b/${id}.json`)).text(),
      await (await call(`/b/${id}`)).text(),
      await (await call("/bids.json")).text(),
      await (await call("/bids")).text()
    ];
    for (const body of responses) {
      expect(body).not.toContain("buyer-secret");
      expect(body).not.toContain("secret-callback");
    }
  });
});

describe("callbacks", () => {
  test("each new answer POSTs the public shape to the bid's callback, once", async () => {
    const id = await placed({ callback_url: CALLBACK, email: EMAIL });
    expect(outbound).toEqual([]);
    await answer(id);
    await answer(id, { ...ANSWER, handle: "shane" });
    expect(outbound.map((o) => o.url)).toEqual([CALLBACK, CALLBACK]);
    const sent = JSON.parse(outbound[1].init.body);
    expect(sent).toMatchObject({ id, status: "answered" });
    expect(sent.answers.map((a) => a.handle)).toEqual(["dipak", "shane"]);
    expect(outbound[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(outbound[0].init.body).not.toContain("buyer-secret");
  });

  test("a failing callback is logged and the answer still lands", async () => {
    const id = await placed({ callback_url: CALLBACK });
    globalThis.fetch.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await answer(id);
    expect(response.status).toBe(201);
    expect(warn).toHaveBeenCalledWith(`bid ${id}: callback failed: connection refused`);
  });

  test("a bid without a callback sends nothing", async () => {
    await answer(await placed());
    expect(outbound).toEqual([]);
  });
});

describe("rate limits", () => {
  test("keys one bucket per client and one for the whole site, storing nothing", async () => {
    const client = pass();
    const global = pass();
    await place({}, { BID_RATE_LIMIT: client, BID_GLOBAL_RATE_LIMIT: global });
    expect(client.limit).toHaveBeenCalledWith({ key: "unknown" });
    expect(global.limit).toHaveBeenCalledWith({ key: "global" });
    await sendJson("/bids", "POST", { question: QUESTION, usd: 20 }, { "cf-connecting-ip": "203.0.113.9" }, { BID_RATE_LIMIT: client });
    expect(client.limit).toHaveBeenLastCalledWith({ key: "203.0.113.9" });
    const stored = await runInDurableObject(book(), (_instance, state) => JSON.stringify(state.storage.sql.exec("SELECT * FROM bids").toArray()));
    expect(stored).not.toContain("203.0.113.9");
  });

  test("a client or the site over its limit is refused, and nothing is placed", async () => {
    const mine = await place({}, { BID_RATE_LIMIT: block() });
    expect(mine.status).toBe(429);
    expect(await mine.json()).toEqual({ error: "Too many bids from here. Try again in a minute." });
    expect((await place({}, { BID_GLOBAL_RATE_LIMIT: block() })).status).toBe(429);
    const form = await placeForm({}, { BID_RATE_LIMIT: block() });
    expect(form.status).toBe(429);
    expect(await form.text()).toContain("Too many bids from here.");
    expect((await (await call("/bids.json")).json()).bids).toEqual([]);
  });

  test("the book itself refuses past its hourly cap", async () => {
    for (let i = 0; i < HOURLY_CAP; i++) await book().place({ question: QUESTION, usd_cents: 500, market: "unsorted" });
    const response = await place();
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Lots of bids are coming in right now. Try again in a few minutes." });
  });

  test("both rate-limit bindings are declared", () => {
    expect(typeof env.BID_RATE_LIMIT.limit).toBe("function");
    expect(typeof env.BID_GLOBAL_RATE_LIMIT.limit).toBe("function");
  });
});

describe("the owner's routes", () => {
  test("adding an answer needs the token, and shows on the bid", async () => {
    const id = await placed();
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "test-admin-token" }, { authorization: "Bearer " }]) {
      expect((await answer(id, ANSWER, headers)).status).toBe(401);
    }
    const response = await answer(id);
    expect(response.status).toBe(201);
    const bid = await response.json();
    expect(bid.status).toBe("answered");
    expect(bid.answers).toEqual([{ ...ANSWER, at: expect.any(String) }]);
    expect(bid.events.map((e) => e.type)).toEqual(["opened", "answered"]);
    const html = await (await call(`/b/${id}`)).text();
    expect(html).toContain("<h2>@dipak</h2><blockquote>Pin the grader first.</blockquote>");
    expect(html).toContain(`<a class="go" href="${ANSWER.piece_url}">Buy · $20 →</a>`);
    expect(html).toContain("Answered by @dipak");
    expect((await answer("zzzzzzzzzz")).status).toBe(404);
    expect((await answer(id, { ...ANSWER, preview: "" })).status).toBe(400);
  });

  test("no token is configured, no owner route opens", async () => {
    const id = await placed();
    const response = await sendJson(`/b/${id}/answers`, "POST", ANSWER, { authorization: "Bearer undefined" }, { BIDS_ADMIN_TOKEN: undefined });
    expect(response.status).toBe(401);
  });

  test("taking a bid down needs the token, and then it is gone everywhere", async () => {
    const id = await placed();
    expect((await call(`/b/${id}`, { method: "DELETE" })).status).toBe(401);
    expect((await call(`/b/${id}`, { method: "DELETE", headers: ADMIN })).status).toBe(200);
    expect((await call(`/b/${id}.json`)).status).toBe(404);
    expect((await call(`/b/${id}`)).status).toBe(404);
    expect((await (await call("/bids.json")).json()).bids).toEqual([]);
    expect((await call(`/b/${id}`, { method: "DELETE", headers: ADMIN })).status).toBe(404);
    expect((await answer(id)).status).toBe(404);
  });

  test("unknown and malformed ids are 404s", async () => {
    expect((await call("/b/zzzzzzzzzz.json")).status).toBe(404);
    expect((await call("/b/nope")).status).toBe(404);
    expect(await (await call("/b/nope")).text()).toContain("No live bid has that address.");
  });
});

describe("filled", () => {
  test("no route can set it", async () => {
    const id = await placed({ status: "filled", type: "filled" });
    const attempts = [
      sendJson(`/b/${id}/answers`, "POST", { ...ANSWER, type: "filled", rail: "card", proof: "https://x.example" }, ADMIN),
      sendJson(`/b/${id}`, "POST", { type: "filled" }, ADMIN),
      sendJson(`/b/${id}`, "PATCH", { status: "filled" }, ADMIN),
      sendJson(`/b/${id}`, "PUT", { status: "filled" }, ADMIN),
      sendJson(`/b/${id}.json`, "POST", { status: "filled" }, ADMIN),
      sendJson(`/b/${id}/filled`, "POST", { rail: "card" }, ADMIN),
      sendJson("/bids.json", "POST", { id, status: "filled" }, ADMIN)
    ];
    await Promise.all(attempts);
    const bid = await (await call(`/b/${id}.json`)).json();
    expect(bid.status).toBe("answered");
    expect(bid.events.map((e) => e.type)).not.toContain("filled");
    const methods = Object.getOwnPropertyNames(BidBook.prototype);
    expect(methods.filter((m) => /fill/i.test(m))).toEqual([]);
  });
});

describe("the board", () => {
  const markets = [
    { id: "rl-evals", name: "RL evals", tab: "AI" },
    { id: "diving", name: "Diving", tab: "Travel" }
  ];
  const bid = (id, market, usd, answers = 0) => ({ id, market, usd, question: `Question ${id} is long enough?`, created: "2026-10-31T22:10:00Z", answers: Array(answers).fill({}) });

  test("draws a column per market, bids by amount, the richest market first and unsorted last", () => {
    const exchange = { market: (id) => (id === "rl-evals" ? { rows: [{ price: 3 }, { price: 1 }] } : undefined) };
    const { html, key } = board([bid("a", "unsorted", 900), bid("b", "rl-evals", 10), bid("c", "rl-evals", 40, 1), bid("d", "diving", 20)], markets, exchange);
    const order = [...html.matchAll(/href="\/b\/(\w)"/g)].map((m) => m[1]);
    expect(order).toEqual(["c", "b", "d", "a"]);
    expect(key).toBe("rl-evals@$1|c:1|b:0|diving@|d:0|unsorted@|a:0");
    expect(html).toContain("<span>Top bid <b>$40</b></span><span>Lowest ask <b>$1</b></span>");
    expect(html).toContain("<span>Top bid <b>$20</b></span><span>No pieces yet</span>");
    expect(html).toContain('<a href="/marketplace/rl-evals">RL evals</a>');
    expect(html).not.toContain('href="/marketplace/diving"');
    expect(html).toContain(">Unsorted</h3>");
  });

  test("every bid is a link whose text is its question, with its amount beside it", async () => {
    const id = await placed();
    const html = await (await call("/bids")).text();
    expect(html).toContain(`<a class="q" href="/b/${id}">${QUESTION}</a>`);
    expect(html).toMatch(new RegExp(`href="/b/${id}">[^<]+</a><span class="who">just now · 0 answers</span></span><span class="pill">\\$20</span>`));
    expect(html).toContain('data-poll="/bids/stats.json"');
  });

  test("the poll carries the counts, the ticker and the board, each keyed to move on real news", async () => {
    const before = await (await call("/bids/stats.json")).json();
    expect(before).toMatchObject({ bids: 0, offered: 0, markets: 0, tape: "", board_key: "" });
    expect(before.board).toContain("No live bids yet.");
    const id = await placed();
    const placedNow = await (await call("/bids/stats.json")).json();
    expect(placedNow).toMatchObject({ bids: 1, offered: 20, markets: 1 });
    expect(placedNow.tape).toContain(`<a href="/b/${id}"><time>just now</time>New bid · $20 · RL evals: How do you stop reward hacking on long coding t…</a>`);
    expect(placedNow.board).toContain(`href="/b/${id}"`);
    await answer(id);
    const answered = await (await call("/bids/stats.json")).json();
    expect(answered.tape).toContain("Answered · $20 · @dipak · RL evals");
    expect(answered.tape_key).not.toBe(placedNow.tape_key);
    expect(answered.board_key).toBe(`rl-evals@|${id}:1`);
    await call(`/b/${id}`, { method: "DELETE", headers: ADMIN });
    const emptied = await (await call("/bids/stats.json")).json();
    expect(emptied).toMatchObject({ bids: 0, tape: "", board_key: "" });
    expect(emptied.board).toContain("No live bids yet.");
  });

  test("a form mistake comes back with the sheet open", async () => {
    const html = await (await placeForm({ usd: "2" })).text();
    expect(html).toContain('<details class="sheet" open><summary class="go">Place a bid</summary>');
    expect(html).toContain("Bids are $5 to $1,000.");
    expect(await (await call("/bids")).text()).toContain('<details class="sheet"><summary');
  });
});
