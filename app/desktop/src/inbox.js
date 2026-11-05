// APP-283: what the Inbox lists and where a bid stands, worked out from plain data. Its own script, loaded before
// renderer.js, which draws each row and gives it its action; test/inbox.test.cjs runs it without a window.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** contracts/bids.md: a bid closes a week after it opens, and the board doesn't carry when it opened. */
const BID_WEEK_MS = 7 * DAY_MS;

class Inbox {
  /** @param {number} [now] */
  constructor(now = Date.now()) {
    this.now = now;
  }

  /** @param {number} usd */
  static dollars(usd) {
    return `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;
  }

  /** @param {number} count @param {string} noun @param {string} [many] */
  static plural(count, noun, many = noun.replace(/([^aeiou])y$/, "$1ie") + "s") {
    return `${count} ${count === 1 ? noun : many}`;
  }

  /** How long ago, the way an inbox says it: "now", "12m", "3h", "2d", then the date. @param {string | null | undefined} iso */
  age(iso) {
    const at = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(at)) return "";
    const ms = Math.max(0, this.now - at);
    if (ms < 60_000) return "now";
    if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)}m`;
    if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h`;
    if (ms < BID_WEEK_MS) return `${Math.floor(ms / DAY_MS)}d`;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
  }

  /** What is left of a bid's week, or null once it closed. @param {string} expires */
  left(expires) {
    const ms = Date.parse(expires) - this.now;
    if (!(ms > 0)) return null;
    if (ms >= 2 * DAY_MS) return Inbox.plural(Math.floor(ms / DAY_MS), "day");
    if (ms >= HOUR_MS) return Inbox.plural(Math.floor(ms / HOUR_MS), "hour");
    return "under an hour";
  }

  /** When a bid opened: its week back from when it closes. @param {BidMatch["bid"]} bid */
  static posted(bid) {
    return new Date(Date.parse(bid.expires) - BID_WEEK_MS).toISOString();
  }

  /** Every row, newest first; rows with no time of their own (a draft, a next step) stand at the top, in the order given.
   * @param {InboxInput} input @returns {InboxRow[]} */
  rows(input) {
    /** @type {InboxRow[]} */
    const rows = [];
    /** @param {Omit<InboxRow, "tail" | "at" | "done" | "title" | "lead" | "amount"> & Partial<InboxRow>} row */
    const add = (row) => rows.push({ amount: "", lead: "", title: "", tail: "", at: null, done: false, ...row });
    for (const match of input.bids.filter((each) => Date.parse(each.bid.expires) > this.now)) {
      const id = match.bid.id;
      const drafted = input.drafts.some((draft) => draft.bid === id);
      const ready = input.answered.has(id);
      const count = match.memories.length;
      const answer = count > 1 ? `${count} of your memories answer this` : count ? "1 of your memories answers this" : "";
      const tail = ready ? "Your answer is ready" : drafted ? "Your answer is drafted" : input.drafting.has(id) ? "Lore is drafting your answer" : answer;
      add({ key: `bid:${id}`, kind: "bid", glyph: "bid", amount: Inbox.dollars(match.bid.usd), title: match.bid.question, tail: tail && `· ${tail}`, at: Inbox.posted(match.bid), verb: ready ? "View" : drafted ? "Review" : "Answer", done: true, ref: id });
    }
    for (const draft of input.drafts.filter((each) => !each.bid)) add({ key: `draft:${draft.title}`, kind: "draft", glyph: "draft", lead: "Draft ready:", title: `“${draft.title}”`, verb: "Review", ref: draft.title });
    if (input.updates) add({ key: "updates", kind: "draft", glyph: "draft", lead: "Ready to approve:", title: `new free parts for ${Inbox.plural(input.updates, "piece")} on sale`, verb: "Review" });
    if (input.offer) add({ key: "offer", kind: "step", glyph: "store", title: input.offer.label, verb: input.offer.action });
    for (const problem of input.problems) add({ key: `problem:${problem.key}`, kind: "problem", glyph: "alert", title: problem.name, tail: problem.says, verb: problem.verb, ref: problem.key });
    if (input.step) add({ key: `step:${input.step.label}`, kind: "step", glyph: input.step.mark, title: input.step.label, tail: input.step.what ? `· ${input.step.what}` : "", verb: input.step.action });
    if (input.checkIn) {
      const count = input.checkIn.questions.length;
      add({ key: "checkin", kind: "checkin", glyph: "ask", lead: "Check-in:", tail: `${Inbox.plural(count, "question")} about today`, at: input.checkIn.at, verb: "Talk it through", done: true });
    }
    for (const task of input.tasks) add({ key: `task:${task.kind}`, kind: "task", glyph: "unfinished", title: task.title, tail: `· ${task.state === "working" ? "Working" : task.phase || "Waiting for you"}`, at: task.updatedAt, verb: "Open", ref: task.kind });
    if (input.reading) add({ key: "reading", kind: "reading", glyph: "working", title: `${input.reading.phase}…`, at: input.reading.updatedAt, verb: "View" });
    for (const group of input.ready) {
      const what = group.memories ? Inbox.plural(group.memories, "new memory", "new memories") : Inbox.plural(group.saves, "save");
      const tail = !group.memories ? " · already in your memories" : group.selling ? ` · ${group.selling} worth selling` : "";
      // Who brought them in, or what the routine that wrote them was asked, in its own words.
      const said = group.from ? { title: what, tail: `from ${group.from}${tail}` } : { title: group.title, tail: `· ${what}${tail}` };
      add({ key: `ready:${group.key}`, kind: "memories", glyph: "memory", ...said, at: group.at, verb: group.memories ? "Review" : "View", done: true, ref: group.key });
    }
    for (const each of input.suggestions) add({ key: `suggestion:${each.title.toLowerCase()}`, kind: "suggestion", glyph: "collection", lead: "Lore suggests a collection:", title: `“${each.title}”`, tail: `· ${Inbox.plural(each.count, "memory", "memories")}`, at: each.at, verb: "Review", done: true, ref: each.title });
    for (const sale of input.sales) {
      const free = sale.network === "free";
      add({ key: `sale:${sale.tx}`, kind: "sale", glyph: free ? "sold" : "bid", amount: free ? "" : `+${Inbox.dollars(sale.price_usd)}`, lead: free ? "Someone read a free copy of" : "Sold", title: `“${sale.title}”`, at: sale.sold_at, verb: "View", done: true, ref: sale.tx });
    }
    if (input.help) add({ key: "help", kind: "help", glyph: "help", lead: "New to Lore?", title: "See how it works", verb: "Read", done: true });
    const order = new Map(rows.map((row, index) => [row, index]));
    const time = (/** @type {InboxRow} */ row) => (row.at ? Date.parse(row.at) : Infinity);
    return rows.sort((a, b) => time(b) - time(a) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  /** A market's slug in words, "rl-evals" as "Rl evals"; a bid with no market has none. @param {string} slug */
  static market(slug) {
    return slug && slug !== "unsorted" ? slug[0].toUpperCase() + slug.slice(1).replace(/-/g, " ") : "";
  }

  /** A bid on the board that nothing the owner kept answers, shaped like a match with no memories. @param {BoardBid} bid
   * @returns {BidMatch} */
  static unmatched(bid) {
    return { bid, memories: [], score: 0, strength: "good" };
  }

  /** APP-288: the Bids page's rows. Matches lists what the owner's memories answer, best first; All lists the board in
   * its own order, then any match the last look didn't list. A closed bid is on neither. @param {BidsInput} input
   * @returns {BidRow[]} */
  bids({ matches, board, tab, drafting, drafted, answered }) {
    const open = (/** @type {BoardBid} */ bid) => Date.parse(bid.expires) > this.now;
    const found = new Map(matches.filter((match) => open(match.bid)).map((match) => [match.bid.id, match]));
    const onBoard = board.filter(open).map((bid) => found.get(bid.id) ?? Inbox.unmatched(bid));
    const listed = tab === "matches" ? [...found.values()] : [...onBoard, ...[...found.values()].filter((match) => !onBoard.includes(match))];
    return listed.map(({ bid, memories, strength }) => {
      const pill = answered.has(bid.id) ? { label: "Answer ready", tint: "live" } : drafted.has(bid.id) ? { label: "Answer drafted", tint: "pending" } : drafting.has(bid.id) ? { label: "Drafting", tint: "pending" } : null;
      return { id: bid.id, amount: Inbox.dollars(bid.usd), question: bid.question, market: Inbox.market(bid.market), left: this.left(bid.expires) ?? "", pill, strength: !memories.length ? 0 : strength === "strong" ? 3 : 2 };
    });
  }

  /** APP-282, APP-289: Inventory's rows as one list: drafts first, then pieces and memories together, most recently
   * updated first. A memory sold on its own as a live piece is that piece's row, not a second row beside it with the
   * same title: one status per thing. A taken-down piece is private again, so the counts add up to All, but it leaves
   * the list for `down`, shown apart so it never reads as a second live copy.
   * @param {{memories: MemoryItem[], pieces: PublicationItem[], drafts: PublicationCandidate[], tab: Shelf}} input */
  static inventory({ memories, pieces, drafts, tab }) {
    const kept = new Map(memories.map((memory) => [memory.id, memory]));
    /** The first memory it was drafted from that is still kept. @param {number[] | undefined} ids */
    const origin = (ids) => (ids ?? []).map((id) => kept.get(id)).find(Boolean);
    const sole = (/** @type {number[] | undefined} */ ids) => (ids?.length === 1 ? [ids[0]] : []);
    const sold = new Set(pieces.filter((item) => item.state === "approved").flatMap((item) => sole(item.provenance)));
    /** When a row last changed, as its date column shows it: a bare date is that day where the owner is, not in UTC.
     * @param {InventoryRow} row */
    const time = (row) => {
      const iso = (row.kind === "piece" ? row.item.updated_at ?? row.from?.updated_at : row.kind === "memory" ? row.item.updated_at : "") ?? "";
      return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00` : iso) || 0;
    };
    /** @type {InventoryRow[]} */
    const listed = [
      ...[...pieces].sort((a, b) => b.id - a.id).map((item) => ({ key: `piece:${item.id}`, kind: /** @type {const} */ ("piece"), shelf: item.state === "approved" ? /** @type {const} */ ("sale") : /** @type {const} */ ("private"), item, from: origin(item.provenance) })),
      ...memories.filter((item) => !sold.has(item.id)).map((item) => ({ key: `memory:${item.id}`, kind: /** @type {const} */ ("memory"), shelf: /** @type {const} */ ("private"), item, from: item }))
    ];
    /** @type {InventoryRow[]} */
    const rows = [
      ...drafts.map((item, at) => ({ key: `draft:${at}`, kind: /** @type {const} */ ("draft"), shelf: /** @type {const} */ ("draft"), item, from: origin(item.provenance) })),
      ...listed.sort((a, b) => time(b) - time(a))
    ];
    const counts = { all: rows.length, private: 0, draft: 0, sale: 0 };
    for (const row of rows) counts[row.shelf]++;
    const shown = rows.filter((each) => tab === "all" || each.shelf === tab);
    const down = shown.filter((row) => row.kind === "piece" && row.item.state === "revoked");
    return { counts, rows: shown.filter((each) => !down.includes(each)), down };
  }

  /** Where a bid stands for the owner, the first that holds: dismissed, approved, closed, drafted, being drafted, then
   * matched (or not, when Lore found nothing). @param {BidLook} look @returns {BidState} */
  state({ match, drafting, draft, approved, dismissed }) {
    if (dismissed) return "dismissed";
    if (approved) return "approved";
    if (!(Date.parse(match.bid.expires) > this.now)) return "expired";
    if (draft) return "drafted";
    if (drafting) return "drafting";
    return match.memories.length ? "matched" : "unmatched";
  }

  /** The bid's page, in words: its status, time left and timeline, newest last.
   * @param {BidLook} look */
  bid(look) {
    const { bid, memories } = look.match;
    const state = this.state(look);
    const count = memories.length;
    const left = this.left(bid.expires);
    const pays = Inbox.dollars(bid.usd);
    const status = { matched: "Open", unmatched: "Open", drafting: "Drafting", drafted: "Answer drafted", approved: "Answer ready", expired: "Closed", dismissed: "Dismissed" }[state];
    /** Who did it, in bold, then what they did; `glyph` names its icon, "lore" being Lore's own mark.
     * @type {Array<{actor: string, glyph: string, text: string, at?: string, live?: boolean}>} */
    const activity = [{ actor: "The buyer", glyph: "bid", text: `posted this bid for ${pays}`, at: Inbox.posted(bid) }];
    activity.push({ actor: "Lore", glyph: "lore", text: count ? `found ${Inbox.plural(count, "matching memory", "matching memories")}` : "found nothing you know that answers it" });
    const from = Inbox.plural(count, "memory", "memories");
    if (state === "drafting") activity.push({ actor: "Lore", glyph: "lore", text: `is drafting from ${from}…`, live: true });
    if (state === "drafted" || state === "approved" || (state !== "dismissed" && look.draft)) activity.push({ actor: "Lore", glyph: "draft", text: `drafted the answer from ${from}` });
    if (state === "approved") activity.push({ actor: "You", glyph: "check", text: "approved the answer" });
    if (state === "dismissed") activity.push({ actor: "You", glyph: "person", text: "dismissed this bid" });
    if (state === "expired") activity.push({ actor: "The bid", glyph: "working", text: "closed", at: bid.expires });
    return { state, status, left, activity };
  }
}

if (typeof module === "object") module.exports = { Inbox };
