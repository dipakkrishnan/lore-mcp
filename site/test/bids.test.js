import { createExecutionContext, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { board } from "../src/bid-board.js";
import { callbackAllowed } from "../src/bid-callback.js";
import { readAnswer, readBid } from "../src/bid-input.js";
import { CARD_TERMS } from "../src/bid-pages.js";
import { BidDesk } from "../src/bid-routes.js";
import { ACCEPT_MS, BidBook, HOURLY_CAP, LIFETIME_MS, statusOf } from "../src/bids.js";
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
  await runInDurableObject(book(), async (_instance, state) => {
    state.storage.sql.exec("DELETE FROM bid_events; DELETE FROM bids; DELETE FROM meta; DELETE FROM buyers; DELETE FROM charges");
    await state.storage.deleteAlarm();
  });
  await env.CHECKOUT.forget();
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

/** A person's bid: the form post, Stripe's setup page, then checkout's word that the card is saved. */
async function cardedBid(fields = {}, payment_method = "pm_card_visa") {
  const response = await placeForm(fields);
  expect(response.status).toBe(303);
  const [, id] = response.headers.get("location").match(/^https:\/\/checkout\.stripe\.test\/c\/setup\/([a-z0-9]{10})$/);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  expect(await exports.BidRail.cardSaved(id, { customer: "cus_buyer", payment_method })).toBe(true);
  return { id, cookie };
}
const charges = async () => (await env.CHECKOUT.asked()).filter((call) => call.charge).map((call) => call.charge);
const shape = async (id, headers = {}) => (await call(`/b/${id}.json`, { headers })).json();
/**
 * Runs the book's alarm until every accepted charge has gone to checkout. The alarm may already be
 * running on its own (it's set for "now"), so this waits for that run instead of racing it.
 */
const drain = () =>
  vi.waitFor(async () => {
    await runDurableObjectAlarm(book());
    const unsent = await runInDurableObject(book(), (_instance, state) =>
      state.storage.sql
        .exec(`SELECT COUNT(*) AS n FROM bid_events a WHERE a.type = 'accepted' AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.seq = a.seq)
          AND NOT EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = a.bid_id AND e.seq > a.seq AND e.type IN ('declined', 'filled', 'removed'))`)
        .one().n
    );
    expect(unsent).toBe(0);
  });
/** What Stripe would report for the charge the fake checkout made last for this bid. */
const settlement = async (id, overrides = {}) => {
  const attempt = (await charges()).findLast((c) => c.bid === id).attempt;
  return { payment_intent: `pi_${attempt.replace(/-/g, "_")}`, charge: "ch_paid", amount_cents: 2000, currency: "usd", account: "acct_1Seller", ...overrides };
};

describe("placing a bid", () => {
  test("a JSON post gets an id, a page and a status address, open for 7 days", async () => {
    const response = await place();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["card", "expires", "id", "status_url", "url"]);
    expect(body.card).toBe(false);
    expect(body.id).toMatch(/^[a-z0-9]{10}$/);
    expect(body.url).toBe(`https://yourlore.dev/b/${body.id}`);
    expect(body.status_url).toBe(`https://yourlore.dev/b/${body.id}.json`);
    const bid = await (await call(`/b/${body.id}.json`)).json();
    expect(bid).toMatchObject({ id: body.id, question: QUESTION, usd: 20, market: "rl-evals", status: "open", card: false, answers: [], events: [{ type: "opened" }] });
    expect(Date.parse(bid.expires) - Date.parse(bid.created)).toBe(LIFETIME_MS);
    expect(bid.created).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  test("a form post, with no script, saves a card with Stripe and lands on the bid's own page", async () => {
    const { id } = await cardedBid();
    const html = await (await call(`/b/${id}`)).text();
    expect(html).toContain(`<title>${QUESTION}</title>`);
    expect(html).toContain(`<h1>${QUESTION}</h1>`);
    expect(html).toContain(`<link rel="alternate" type="application/json" href="/b/${id}.json">`);
    expect(html).toContain('<ul class="props"><li><b>$20</b> offered</li><li>Card on file</li><li><a href="/bids?market=rl-evals">RL evals</a></li><li>7 days left</li><li>New</li></ul>');
  });

  test("an open bid's page offers a way to answer it and a way to pass it on, and no API spec", async () => {
    const id = await placed();
    const html = await (await call(`/b/${id}`)).text();
    expect(html).toContain(`<a class="go" href="/download?bid=${id}">Answer with Lore</a>`);
    expect(html).toContain(`<a class="quiet" data-share href="https://yourlore.dev/b/${id}">Share</a>`);
    expect(html).not.toMatch(/POST \/bids|callback_url|<code/);
    expect(html).toContain('<a href="/llms.txt">For agents</a>');
    const download = await call(`/download?bid=${id}`, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36" } });
    expect(download.status).toBe(200);
    expect(await download.text()).toContain(`Once Lore is open, <a href="/b/${id}">answer the bid</a> you came from.`);
  });

  test("the /bids page carries a form that posts without a script", async () => {
    const html = await (await call("/bids")).text();
    expect(html).toMatch(/<form class="bid-form" method="post" action="\/bids">/);
    expect(html).toContain('<option value="rl-evals">RL evals</option>');
    expect(html).toContain(CARD_TERMS);
    expect(html).toContain('<button class="go" type="submit">Place bid</button>');
    expect(html).toContain('<input type="checkbox" name="card" value="skip">');
    expect(html).not.toContain('name="email"');
  });

  test("a browser agent ticks the agent box and its bid opens at once, with no card and no Stripe page", async () => {
    const response = await placeForm({ card: "skip" });
    expect(response.status).toBe(303);
    const [, id] = response.headers.get("location").match(/^https:\/\/yourlore\.dev\/b\/([a-z0-9]{10})$/);
    expect(await env.CHECKOUT.asked()).toEqual([]);
    const html = await (await call(`/b/${id}`)).text();
    expect(html).toContain("<li>No card on file</li>");
    expect(html).toContain(`<a href="/b/${id}.json">This bid as JSON</a>`);
  });

  test("the board marks each row with its bid and amount, and lists them as structured data", async () => {
    const id = await placed();
    const html = await (await call("/bids")).text();
    expect(html).toContain(`data-bid="${id}" data-usd="20"`);
    expect(html).toContain('<a href="/bids.json">As JSON</a>');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(data.itemListElement).toEqual([{ "@type": "ListItem", position: 1, url: `https://yourlore.dev/b/${id}`, name: QUESTION }]);
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
    const { bid } = (await book().place({ question: QUESTION, usd_cents: 2000, market: "rl-evals" }, { now: old })).found;
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
    const { bid } = (await book().place({ question: QUESTION, usd_cents: 2000, market: "rl-evals" }, { now: old })).found;
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
    expect(html).toContain(`<a class="go" href="${ANSWER.piece_url}">Buy · $20</a>`);
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
    // The book's one filling method is reached only through the BidRail service binding.
    expect(Object.getOwnPropertyNames(BidBook.prototype).filter((m) => /fill|paid/i.test(m))).toEqual(["paid"]);
    expect(Object.getOwnPropertyNames(BidDesk.prototype).filter((m) => /fill|paid/i.test(m))).toEqual([]);
  });
});

describe("a card on every person's bid (MON-054)", () => {
  test("placing by form saves a card first; the bid opens only when checkout says Stripe saved it", async () => {
    const response = await placeForm();
    const [, id] = response.headers.get("location").match(/setup\/([a-z0-9]{10})$/);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^lore_bid_${id}=[a-z0-9]{32}; Path=/b/${id}; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$`));
    const [{ setup }] = await env.CHECKOUT.asked();
    expect(setup).toEqual({ bid: id, question: QUESTION, customer: null, return_url: `https://yourlore.dev/b/${id}` });
    expect(await shape(id)).toMatchObject({ status: "pending", card: false, events: [] });
    expect((await (await call("/bids.json")).json()).bids).toEqual([]);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    expect(await (await call(`/b/${id}`, { headers: { cookie } })).text()).toContain("Your card isn't saved yet");

    const card = { customer: "cus_buyer", payment_method: "pm_card_visa" };
    expect(await exports.BidRail.cardSaved(id, card)).toBe(true);
    expect(await exports.BidRail.cardSaved(id, card)).toBe(false);
    expect(await shape(id)).toMatchObject({ status: "open", card: true, events: [{ type: "opened" }] });
    expect((await (await call("/bids.json")).json()).bids.map((b) => b.id)).toEqual([id]);
  });

  test("a bid whose card can't be set up says so and keeps what was typed", async () => {
    const response = await placeForm({ question: "What happens when checkout is down?" });
    expect(response.status).toBe(502);
    const html = await response.text();
    expect(html).toContain("Saving a card isn&#39;t working right now. Try again in a minute.");
    expect(html).toContain("What happens when checkout is down?");
  });

  test("an agent's bid without a card is labeled and listed below carded ones", async () => {
    const { id: carded } = await cardedBid({ question: "The carded question, placed first?" });
    const bare = await placed();
    expect((await (await call("/bids.json")).json()).bids.map((b) => [b.id, b.card])).toEqual([[carded, true], [bare, false]]);
    const board = await (await call("/bids")).text();
    expect(board.indexOf(carded)).toBeLessThan(board.indexOf(bare));
    expect(board).toContain("<span>No card on file</span>");
    expect(await (await call(`/b/${bare}`)).text()).toContain("No card is on file, so payment isn't guaranteed.");
  });

  test("an agent can ask for a card: it gets Stripe's page for its person and a key", async () => {
    const body = await (await place({ card: true })).json();
    expect(body).toMatchObject({ card: true, card_url: `https://checkout.stripe.test/c/setup/${body.id}` });
    expect(body.key).toMatch(/^[a-z0-9]{32}$/);
    expect(body.manage_url).toBe(`${body.url}?key=${body.key}`);
    const page = await call(`/b/${body.id}?key=${body.key}`);
    expect(page.headers.get("set-cookie")).toContain(`lore_bid_${body.id}=${body.key}`);
    expect(await shape(body.id, { authorization: `Bearer ${body.key}` })).toMatchObject({ receipt_url: null, payment_problem: null });
    expect(await shape(body.id)).not.toHaveProperty("receipt_url");
  });

  test("accepting charges once, straight to the answer's seller, and only the rail fills it", async () => {
    const { id, cookie } = await cardedBid();
    await answer(id);
    expect(await (await call(`/b/${id}`, { headers: { cookie } })).text()).toContain("Accept and pay $20");
    expect(await (await call(`/b/${id}`)).text()).not.toContain("Accept and pay");
    const accepted = await call(`/b/${id}/accept`, { method: "POST", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body: "answer=0" });
    expect(accepted.status).toBe(303);
    expect((await shape(id)).status).toBe("paying");

    await drain();
    await drain();
    const sent = await charges();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ bid: id, customer: "cus_buyer", payment_method: "pm_card_visa", piece_url: ANSWER.piece_url, usd_cents: 2000 });
    expect(await (await call(`/b/${id}`, { headers: { cookie } })).text()).toContain("Charging your card to pay @dipak");

    const payment = await settlement(id);
    expect(await exports.BidRail.paid(id, payment)).toBe("filled");
    expect(await exports.BidRail.paid(id, payment)).toBe("filled");
    expect(await exports.BidRail.paid(id, { ...payment, payment_intent: "pi_other" })).toBe("rejected");
    const bid = await shape(id);
    expect(bid.status).toBe("filled");
    expect(bid.events.filter((e) => e.type === "filled")).toEqual([{ type: "filled", at: expect.any(String), rail: "card", proof: "ch_paid" }]);
    expect(JSON.stringify(bid)).not.toContain(payment.payment_intent);
    const mine = await (await call(`/b/${id}`, { headers: { cookie } })).text();
    expect(mine).toContain(`href="${ANSWER.piece_url}?session_id=${payment.payment_intent}">Read the answer</a>`);
  });

  test("only the buyer can accept, only an answer that exists, and only with a card", async () => {
    const { id, cookie } = await cardedBid();
    const accept = (headers, body = { answer: 0 }) => sendJson(`/b/${id}/accept`, "POST", body, headers);
    expect((await accept({ cookie })).status).toBe(409);
    await answer(id);
    expect((await accept({})).status).toBe(403);
    expect((await accept({ authorization: `Bearer ${"x".repeat(32)}` })).status).toBe(403);
    expect((await accept({ cookie }, { answer: 3 })).status).toBe(409);
    const bare = await placed();
    await answer(bare);
    expect((await sendJson(`/b/${bare}/accept`, "POST", { answer: 0 }, { cookie })).status).toBe(403);
    expect((await accept({ cookie })).status).toBe(202);
    expect((await accept({ cookie })).status).toBe(202);
    expect((await accept({ cookie }, { answer: 1 })).status).toBe(409);
  });

  test("a declined card leaves the bid answered, says so plainly, and a new card pays the same answer", async () => {
    const { id, cookie } = await cardedBid({}, "pm_declined");
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    await drain();
    expect((await shape(id)).status).toBe("answered");
    const page = await (await call(`/b/${id}`, { headers: { cookie } })).text();
    expect(page).toContain("Your card was declined. @dipak hasn't been paid. Update your card and we'll try again.");
    expect(page).not.toContain("Accept and pay");
    expect(await (await call(`/b/${id}`)).text()).not.toContain("declined");

    const update = await call(`/b/${id}/card`, { method: "POST", headers: { cookie } });
    expect(update.status).toBe(303);
    expect((await env.CHECKOUT.asked()).at(-1).setup.customer).toBe("cus_buyer");
    await exports.BidRail.cardSaved(id, { customer: "cus_buyer", payment_method: "pm_card_visa" });
    expect((await shape(id)).status).toBe("paying");
    await drain();
    const sent = await charges();
    expect(sent.map((c) => c.payment_method)).toEqual(["pm_declined", "pm_card_visa"]);
    expect(new Set(sent.map((c) => c.attempt)).size).toBe(2);
    expect(await exports.BidRail.paid(id, await settlement(id))).toBe("filled");
  });

  test("a bank asking to confirm is a plain problem too", async () => {
    const { id, cookie } = await cardedBid({}, "pm_authenticate");
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    await drain();
    expect(await shape(id, { cookie })).toMatchObject({ status: "answered", payment_problem: "Your bank wants to confirm this payment." });
  });

  test("the first answer is accepted on its own 2 days after it came in", async () => {
    const { id } = await cardedBid();
    await book().answer(id, { ...ANSWER, usd_cents: 2000 }, Date.now() - ACCEPT_MS - 60_000);
    await book().answer(id, { ...ANSWER, handle: "second", usd_cents: 2000 }, Date.now() - 60_000);
    await drain();
    const bid = await shape(id);
    expect(bid.status).toBe("paying");
    expect(bid.events.find((e) => e.type === "accepted")).toMatchObject({ answer: 0, auto: true });
    expect((await charges()).map((c) => c.bid)).toEqual([id]);
  });

  test("a carded bid answered late in its week is accepted at the week's end, not ended", async () => {
    const { id } = await cardedBid();
    await book().answer(id, { ...ANSWER, usd_cents: 2000 });
    const later = await book().find(id, Date.now() + LIFETIME_MS + 60_000);
    expect(later.events.map((e) => e.type)).toEqual(["opened", "answered", "accepted"]);
  });

  test("a declined card not replaced within 2 days ends the bid and counts as walked away", async () => {
    const { id, cookie } = await cardedBid({}, "pm_declined");
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    await drain();
    expect((await book().find(id, Date.now() + ACCEPT_MS + 60_000)).events.at(-1).type).toBe("declined");
    const ended = await book().find(id, Date.now() + LIFETIME_MS + 60_000);
    expect(ended.events.at(-1).type).toBe("expired");
    expect(await book().walkedAway(Date.now() + LIFETIME_MS + 60_000)).toBe(1);
  });

  test("two alarm runs at once send an accepted charge once", async () => {
    const { id, cookie } = await cardedBid();
    await answer(id);
    await runInDurableObject(book(), async (instance, state) => {
      await instance.accept(id, cookie.split("=")[1], 0);
      await state.storage.deleteAlarm();
      await Promise.all([instance.alarm(), instance.alarm()]);
    });
    expect((await charges()).map((c) => c.bid)).toEqual([id]);
  });

  test("a charge checkout couldn't send is kept and tried again", async () => {
    const { id, cookie } = await cardedBid({}, "pm_unreachable");
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    await vi.waitFor(async () => {
      await runDurableObjectAlarm(book());
      expect((await charges()).length).toBeGreaterThanOrEqual(2);
    });
    expect(new Set((await charges()).map((c) => c.attempt)).size).toBe(1);
    expect((await shape(id)).status).toBe("paying");
    expect(await runInDurableObject(book(), (_instance, state) => state.storage.getAlarm())).not.toBeNull();
  });

  test("the rail refuses what isn't Stripe's shape or a bid nobody accepted", async () => {
    const { id } = await cardedBid();
    await answer(id);
    const any = { payment_intent: "pi_1", charge: "ch_1", amount_cents: 2000, currency: "usd", account: "acct_1Seller" };
    expect(await exports.BidRail.paid(id, any)).toBe("rejected");
    expect(await exports.BidRail.paid("nope", any)).toBe("rejected");
    expect(await exports.BidRail.paid(id, { ...any, account: "nope" })).toBe("rejected");
    expect(await exports.BidRail.cardSaved(id, { customer: "x", payment_method: "pm_1" })).toBe(false);
    expect((await shape(id)).status).toBe("answered");
  });

  test("only the exact charge Lore made fills the bid: its PaymentIntent, seller account, currency and amount", async () => {
    const { id, cookie } = await cardedBid();
    await answer(id);
    // Stripe's webhook can beat the charge's own reply; the rail says to send it again. The alarm is
    // held inside the object so the charge's reply can't land first.
    const early = { payment_intent: "pi_early", charge: "ch_1", amount_cents: 2000, currency: "usd", account: "acct_1Seller" };
    const key = cookie.split("=")[1];
    const verdict = await runInDurableObject(book(), async (instance, state) => {
      await instance.accept(id, key, 0);
      const said = instance.paid(id, early);
      await state.storage.setAlarm(Date.now());
      return said;
    });
    expect(verdict).toBe("pending");
    await drain();
    for (const wrong of [{ payment_intent: "pi_someone_else" }, { account: "acct_1Other" }, { amount_cents: 1999 }, { amount_cents: 2001 }, { currency: "eur" }]) {
      expect(await exports.BidRail.paid(id, await settlement(id, wrong))).toBe("rejected");
    }
    expect((await shape(id)).status).toBe("paying");
    expect(await exports.BidRail.paid(id, await settlement(id))).toBe("filled");
  });

  test("two accepts at once make one accepted event and one charge", async () => {
    const { id, cookie } = await cardedBid();
    await answer(id);
    const accept = () => sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    const replies = await Promise.all([accept(), accept(), accept()]);
    expect(replies.map((r) => r.status)).toEqual([202, 202, 202]);
    expect((await shape(id)).events.filter((e) => e.type === "accepted")).toHaveLength(1);
    await drain();
    expect(await charges()).toHaveLength(1);
    expect((await sendJson(`/b/${id}/accept`, "POST", { answer: 1 }, { cookie })).status).toBe(409);
  });

  test("a charge that fails or is canceled after it was sent is a decline the buyer can fix", async () => {
    const { id, cookie } = await cardedBid();
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    await drain();
    const { payment_intent, account } = await settlement(id);
    expect(await exports.BidRail.failed(id, { payment_intent: "pi_someone_else", account, message: "Your card was declined." })).toBe("rejected");
    expect((await shape(id)).status).toBe("paying");
    expect(await exports.BidRail.failed(id, { payment_intent, account, message: "Your card was declined." })).toBe("declined");
    expect(await shape(id, { cookie })).toMatchObject({ status: "answered", payment_problem: "Your card was declined." });
    expect(await exports.BidRail.paid(id, await settlement(id))).toBe("rejected");
  });

  test("a bid whose card couldn't be set up leaves nothing behind and spends none of the hour's cap", async () => {
    await placeForm({ question: "What happens when checkout is down?" });
    await runInDurableObject(book(), (_instance, state) => expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM bids").one().n).toBe(0));
  });

  test("a declined bid stays on the board; only a bid being paid leaves it", async () => {
    const { id, cookie } = await cardedBid({}, "pm_declined");
    await answer(id);
    await sendJson(`/b/${id}/accept`, "POST", { answer: 0 }, { cookie });
    const listed = async () => (await (await call("/bids.json")).json()).bids.map((b) => b.id);
    expect(await listed()).toEqual([]);
    await drain();
    expect(await listed()).toEqual([id]);
  });
});

describe("the board", () => {
  const markets = [
    { id: "rl-evals", name: "RL evals", tab: "AI" },
    { id: "diving", name: "Diving", tab: "Travel" }
  ];
  const now = Date.parse("2026-11-01T00:00:00Z");
  const bid = (id, market, usd, answers = 0) => ({ id, market, usd, status: "open", question: `Question ${id} is long enough?`, created: "2026-10-31T22:10:00Z", expires: "2026-11-07T22:10:00Z", answers: Array(answers).fill({}), card: true });

  test("ranks bids with a card above bigger ones without, and says which have none", () => {
    const { html } = board([{ ...bid("a", "rl-evals", 900), card: false }, bid("b", "rl-evals", 10)], markets, "", now);
    expect([...html.matchAll(/href="\/b\/(\w)"/g)].map((m) => m[1])).toEqual(["b", "a"]);
    expect(html.match(/No card on file/g)).toHaveLength(1);
  });

  test("draws one row per bid, biggest first: amount, question, market, time left, answers", () => {
    const { html, key } = board([bid("a", "unsorted", 900), bid("b", "rl-evals", 10), bid("c", "rl-evals", 40, 1), bid("d", "diving", 20)], markets, "", now);
    expect([...html.matchAll(/href="\/b\/(\w)"/g)].map((m) => m[1])).toEqual(["a", "c", "d", "b"]);
    expect(key).toBe("a:0|c:1|d:0|b:0");
    expect(html).toContain('<a class="line" href="/b/c"><span class="amt">$40</span><span class="q">Question c is long enough?</span><span class="side"><span class="mk">RL evals</span><span>7 days left</span><span>1 answer</span></span></a>');
    expect(html).toContain('<a class="line" href="/b/b"><span class="amt">$10</span><span class="q">Question b is long enough?</span><span class="side"><span class="mk">RL evals</span><span>7 days left</span><span>New</span></span></a>');
    expect(html).not.toMatch(/Unsorted|Lowest ask|Top bid/);
  });

  test("a market tab narrows the rows, and only markets with bids get a tab", async () => {
    await placed({ market: "rl-evals" });
    await placed({ market: "", question: "Where should a new diver go first in the Caribbean?" });
    const all = await (await call("/bids")).text();
    expect(all).toContain('<li><a href="/bids" class="on" aria-current="page">All<small>2</small></a></li><li><a href="/bids?market=rl-evals">RL evals<small>1</small></a></li></ul>');
    const narrowed = await (await call("/bids?market=rl-evals")).text();
    expect(narrowed).toContain(QUESTION);
    expect(narrowed).not.toContain("Caribbean");
    expect(narrowed).toContain('data-poll="/bids/stats.json?market=rl-evals"');
    expect((await (await call("/bids/stats.json?market=rl-evals")).json()).board).not.toContain("Caribbean");
  });

  test("every bid is a link whose text is its question, with its amount beside it", async () => {
    const id = await placed();
    const html = await (await call("/bids")).text();
    expect(html).toContain(`<a class="line" href="/b/${id}"><span class="amt">$20</span><span class="q">${QUESTION}</span>`);
    expect(html).toContain('data-poll="/bids/stats.json"');
    expect(html).not.toMatch(/POST \/bids|<code/);
  });

  test("the poll carries the counts and the rows, keyed to move on real news", async () => {
    const before = await (await call("/bids/stats.json")).json();
    expect(before).toMatchObject({ bids: 0, offered: 0, board_key: "" });
    expect(before.board).toContain("No open bids yet.");
    const id = await placed();
    const placedNow = await (await call("/bids/stats.json")).json();
    expect(placedNow).toMatchObject({ bids: 1, offered: 20, board_key: `${id}:0` });
    await answer(id);
    expect((await (await call("/bids/stats.json")).json()).board_key).toBe(`${id}:1`);
    await call(`/b/${id}`, { method: "DELETE", headers: ADMIN });
    const emptied = await (await call("/bids/stats.json")).json();
    expect(emptied).toMatchObject({ bids: 0, board_key: "" });
  });

  test("?ask opens the place-a-bid form, which says how the card is used", async () => {
    const html = await (await call("/bids?ask")).text();
    expect(html).toContain('<details class="sheet" id="ask" open>');
    expect(html).toContain(CARD_TERMS);
  });

  test("a form mistake comes back with the sheet open", async () => {
    const html = await (await placeForm({ usd: "2" })).text();
    expect(html).toContain('<details class="sheet" id="ask" open><summary class="go">Place a bid</summary>');
    expect(html).toContain("Bids are $5 to $1,000.");
    expect(await (await call("/bids")).text()).toContain('<details class="sheet" id="ask"><summary');
  });
});
