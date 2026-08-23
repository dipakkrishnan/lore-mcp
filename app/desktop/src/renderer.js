/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const welcome = $("#welcome");
const appShell = $("#app");
const welcomeNote = $("#welcome-note");
const keyForm = /** @type {HTMLFormElement} */ ($("#key-form"));
const eyebrow = $("#eyebrow");
const title = $("#title");
const status = $("#status");
const content = $("#content");
const account = $("#account");
const captureArea = $("#capture");
const composer = /** @type {HTMLFormElement} */ ($("#composer"));
const input = /** @type {HTMLTextAreaElement} */ ($("#capture-input"));
const attachmentList = $("#attachments");
const submit = /** @type {HTMLButtonElement} */ ($("#capture-submit"));
const agentPanel = $("#agent");
const log = $("#log");
const requestSlot = $("#request");
const search = /** @type {HTMLInputElement} */ ($("#search"));
const navButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav button")]);

/** @typedef {"today" | "memories" | "store" | "settings"} View */
/** @type {Snapshot | null} */
let snapshot = null;
/** @type {AgentStatus | null} */
let auth = null;
/** @type {View} */
let view = "today";
/** @type {AgentTask} */
let task = "capture";
/** @type {string[]} */
let attachments = [];
/** @type {SearchHit[] | null} */
let hits = null;
let liveText = "";
/** @type {string[]} */
const lines = [];
let firstRunDismissed = false;
/** @type {PublicationCandidate[]} */
let candidates = [];
let approvedThisPass = false;
/** @type {string | false} */
let pushOffer = false;

const RING = `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 4.5a8.5 8.5 0 1 1-6 2.5"></path><path d="M13 9a4 4 0 1 1-2.8 1.2"></path><circle cx="13" cy="13" r="1.2" fill="currentColor" stroke="none"></circle></svg>`;
const PROVIDERS = {
  anthropic: ["Claude", "assets/claude.svg"],
  "openai-codex": ["ChatGPT", "assets/openai.svg"],
  openai: ["OpenAI", "assets/openai.svg"]
};
const NETWORKS = { "eip155:8453": "Base", "eip155:84532": "Base Sepolia, test network" };
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric" });
const SETUP_STEPS = /** @type {const} */ ([
  ["sources_configured", "Connect your agents"],
  ["blueprint_configured", "Shape your Lore"],
  ["profile_configured", "Set the rhythm"]
]);

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {string} className */
function mark(className = "mark") {
  const node = el("span", className);
  node.innerHTML = RING;
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** @param {string} label @param {"primary" | "secondary" | "quiet"} kind @param {() => void} onClick */
function button(label, kind, onClick) {
  const node = el("button", `btn ${kind} sm`, label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

/** @param {string} label @param {string} [detail] @param {HTMLElement} [trailing] @param {boolean} [serif] */
function row(label, detail, trailing, serif = true) {
  const node = el("div", "row");
  const text = el("div", "t");
  text.append(el("b", serif ? "" : "sans", label));
  if (detail) text.append(el("span", "", detail));
  node.append(text);
  if (trailing) node.append(trailing);
  return node;
}

marked.use({ renderer: { html: () => "" } });

/** @param {number | string} id @param {string} title @param {string} detail */
function memoryRow(id, title, detail) {
  const node = el("button", "row link");
  node.type = "button";
  const text = el("div", "t");
  text.append(el("b", "", title), el("span", "", detail));
  node.append(text, chip("Private"));
  node.addEventListener("click", () => openMemory(Number(id)));
  return node;
}

/** @param {number} id */
async function openMemory(id) {
  /** @type {Memory} */
  let memory;
  try {
    memory = await window.lore.memory(id);
  } catch (error) {
    say(error instanceof Error ? error.message : "Lore could not open that.");
    return;
  }
  closeSheet();
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", memory.title);
  const panel = el("div", "card sheet-panel");
  const head = el("div", "sheet-head");
  const text = el("div", "t");
  text.append(el("b", "", memory.title), el("span", "", [memory.project, memory.source, when(memory.updated_at)].filter(Boolean).join(" · ")));
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeSheet);
  head.append(text, close);
  const body = el("div", "body");
  body.innerHTML = marked.parse(memory.content, { async: false });
  panel.append(head, body);
  sheet.append(panel);
  sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheet(); });
  document.body.append(sheet);
  close.focus();
}

function closeSheet() {
  document.querySelector(".sheet")?.remove();
}

/** @param {string} heading @param {HTMLElement} body @param {HTMLElement} [aside] */
function section(heading, body, aside) {
  const node = el("section", "section");
  const head = el("div", "section-head");
  head.append(el("h2", "", heading));
  if (aside) head.append(aside);
  node.append(head, body);
  return node;
}

/** @param {HTMLElement[]} rows */
function card(rows) {
  const node = el("div", "card rows");
  node.append(...rows);
  return node;
}

/** @param {string} text @param {string} [className] */
function chip(text, className = "") {
  return el("span", `chip ${className}`, text);
}

/** @param {number | null} value */
function price(value) {
  return typeof value === "number" ? money.format(value) : "Not set";
}

/** @param {string} iso */
function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

/** @param {Snapshot["node"]["live"]["state"]} state */
function nodeLabel(state) {
  return state === "online" ? "Live" : state === "unreachable" ? "Offline" : "Not set up";
}

/** @param {string | null} network */
function networkLabel(network) {
  return (network && NETWORKS[/** @type {keyof typeof NETWORKS} */ (network)]) || network || "";
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

/** @param {Snapshot} s */
function needsYou(s) {
  /** @type {HTMLElement[]} */
  const rows = [];
  const add = (/** @type {string} */ label, /** @type {string} */ detail, /** @type {HTMLElement} */ action) => {
    const lead = el("div", "lead");
    lead.append(el("span", "dot"));
    const text = el("div", "t");
    text.append(el("b", "sans", label), el("span", "", detail));
    lead.append(text);
    const node = el("div", "row");
    node.append(lead, action);
    rows.push(node);
  };
  if (task !== "setup") {
    if (!s.setup.sources_configured) add("Connect your agents", "Let Lore read what Claude Code and Codex already remember.", button("Start", "secondary", startSetup));
    if (!s.setup.blueprint_configured) add("Tell Lore what it's for", "A five-minute conversation shapes what Lore keeps and what it sells.", button("Start", "secondary", startSetup));
    if (!s.setup.profile_configured) add("Choose how Lore learns from your agents", "Decide which model writes new memories, and how often.", button("Start", "secondary", startSetup));
    if (s.library.counts.private && !candidates.length) add("Publish something", "Pick a topic you know well. Lore drafts up to three things to sell; you approve each one.", button("Publish", "secondary", startPublish));
  }
  return rows;
}

/** @param {Snapshot} s */
function firstRun(s) {
  const found = s.library.sources.filter((source) => source.imported > 0);
  const node = el("div", "card pad lead");
  node.style.display = "flex";
  node.style.flexDirection = "column";
  node.style.gap = "12px";
  const says = el("div", "lore-says");
  says.append(mark(), el("p", "", found.length
    ? `Your agents already wrote memories — ${found.map((f) => `${f.imported} in ${f.label}`).join(", ")}. Give me about eight minutes and I'll learn the shape you want, draft who you are from what's there, and start writing your Lore on a schedule.`
    : "Give me about eight minutes and I'll learn the shape you want for your Lore and start writing it on a schedule."));
  const steps = el("div", "steps");
  for (const [n, label, detail, time] of [
    ["1", "Shape your Lore", "Pick how it's organized and how it's told. Five quick questions.", "5 min"],
    ["2", "Read your agents", "I draft who you are and what's valuable. You correct me.", "2 min"],
    ["3", "Set the rhythm", "Which model writes new memories, and when.", "1 min"]
  ]) {
    const step = el("div", "step");
    const text = el("div", "t");
    text.append(el("b", "", label), el("span", "", detail));
    step.append(el("span", "n", n), text, el("span", "time", time));
    steps.append(step);
  }
  const actions = el("div", "request");
  actions.style.padding = "0";
  const foot = el("div", "actions");
  foot.style.justifyContent = "space-between";
  foot.style.alignItems = "center";
  const group = el("div");
  group.style.display = "flex";
  group.style.gap = "8px";
  group.append(button("Later", "quiet", () => { firstRunDismissed = true; render(); }), button("Start", "primary", startSetup));
  foot.append(el("span", "hint", "Everything stays on this Mac. Nothing is sold unless you approve it."), group);
  node.append(says, steps, foot);
  return node;
}

/** @param {Snapshot} s */
function setupSteps(s) {
  const node = el("div", "setup-steps");
  const now = SETUP_STEPS.findIndex(([flag]) => !s.setup[flag]);
  for (const [index, [flag, label]] of SETUP_STEPS.entries()) {
    const step = el("span", s.setup[flag] ? "done" : index === now ? "now" : "");
    step.append(el("span", "n", s.setup[flag] ? "✓" : String(index + 1)), document.createTextNode(label));
    node.append(step);
  }
  return node;
}

/** @param {Snapshot} s */
function renderToday(s) {
  const setup = task === "setup";
  const fresh = !setup && !firstRunDismissed && s.library.counts.private === 0 && !s.setup.blueprint_configured && !s.setup.profile_configured;
  /** @type {HTMLElement[]} */
  const parts = [];
  if (setup) parts.push(setupSteps(s));
  if (fresh) parts.push(firstRun(s));
  if (candidates.length) parts.push(section("Approve what to sell", approvals(), el("span", "hint", "Only what you approve ever leaves this Mac.")));
  if (pushOffer) parts.push(seamCard());
  const attention = fresh ? [] : needsYou(s);
  if (attention.length) parts.push(section("Needs you", card(attention)));
  const recent = s.library.items.filter((item) => item.status === "private").slice(0, 5);
  const all = el("button", "", `All ${s.library.counts.private} →`);
  all.type = "button";
  all.addEventListener("click", () => show("memories"));
  parts.push(section("Recently kept", recent.length
    ? card(recent.map((item) => memoryRow(item.id, item.title, [item.project_label, when(item.updated_at)].filter(Boolean).join(" · "))))
    : Object.assign(el("div", "card pad empty", "Nothing kept yet. The box above is where it begins — or let setup bring in what your agents already know."), {}),
    recent.length ? all : undefined));
  const strip = el("div", "strip");
  /** @type {Array<[string, string] | null>} */
  const facts = [
    [String(s.library.counts.private), `${s.library.counts.private === 1 ? "memory" : "memories"}, only on this Mac`],
    [String(s.publications.counts.active), "for sale"],
    ["Store", nodeLabel(s.node.live.state).toLowerCase()],
    typeof s.pricing.publication_usd === "number" ? [price(s.pricing.publication_usd), "a publication"] : null,
    s.pricing.answer_enabled ? [price(s.pricing.answer_usd), "an answer"] : null
  ];
  for (const fact of facts) {
    if (!fact) continue;
    const item = el("span");
    if (fact[0] === "Store") item.append(document.createTextNode("Store "), el("b", "", fact[1]));
    else item.append(el("b", "", fact[0]), document.createTextNode(` ${fact[1]}`));
    strip.append(item);
  }
  parts.push(strip);
  return parts;
}

/** @param {Snapshot} s */
function renderMemories(s) {
  const items = hits
    ? hits.map((hit) => memoryRow(hit.id, hit.title, [hit.project, when(hit.updated_at)].filter(Boolean).join(" · ")))
    : s.library.items.filter((item) => item.status === "private").map((item) => memoryRow(item.id, item.title, [item.project_label, when(item.updated_at)].filter(Boolean).join(" · ")));
  const heading = hits ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}` : `${items.length} private`;
  const body = items.length ? card(items) : el("div", "card pad empty", hits ? "Nothing matches that." : "Nothing kept yet.");
  return [section(heading, body)];
}

/** @param {Snapshot} s */
function renderStore(s) {
  const live = s.node.live;
  const bar = el("div", "card store-bar");
  const lead = el("div", "lead");
  lead.append(el("span", `dot ${live.state === "online" ? "ok" : live.state === "unreachable" ? "" : "off"}`));
  const text = el("div", "t");
  text.append(el("b", "sans", live.state === "online" ? `Live, answering on ${networkLabel(live.network) || "your node"}` : live.state === "unreachable" ? "Your node isn't answering" : "No store yet"));
  if (s.node.url) {
    const link = el("a", "mono", s.node.url.replace(/^https?:\/\//, "").replace(/\/mcp$/, ""));
    link.href = s.node.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    text.append(link);
  } else {
    text.append(el("span", "", "Open one from Today when you're ready to sell."));
  }
  lead.append(text);
  const prices = el("div", "prices");
  for (const [value, label] of [[price(s.pricing.publication_usd), "a publication"], [s.pricing.answer_enabled ? price(s.pricing.answer_usd) : "Off", "an answer"]]) {
    const item = el("div");
    item.append(document.createTextNode(`${value} `), el("span", "", label));
    prices.append(item);
  }
  bar.append(lead, prices);
  const approved = s.publications.items.filter((item) => item.state === "approved");
  const revoked = s.publications.items.filter((item) => item.state === "revoked");
  /** @param {PublicationItem} item */
  const state = (item) => item.live === true ? chip("Live", "ok") : item.live === false ? chip("Not live yet") : chip("Approved");
  /** @param {PublicationItem} item */
  const controls = (item) => {
    const trailing = el("div", "v");
    const ask = button("Take down", "secondary", () => {
      trailing.replaceChildren(
        el("span", "hint", "Buyers lose it for good."),
        button("Keep", "secondary", () => trailing.replaceChildren(state(item), ask)),
        button("Take down", "primary", async () => {
          if (!(await act(() => window.lore.revoke(item.id)))) return;
          pushOffer = live.state === "online" ? "It stays on sale until you push." : false;
          render();
        })
      );
    });
    trailing.append(state(item), ask);
    return trailing;
  };
  /** @type {HTMLElement[]} */
  const parts = [bar];
  if (pushOffer) parts.push(seamCard());
  parts.push(section("For sale", approved.length
    ? card(approved.map((item) => row(item.title, item.topic, controls(item))))
    : el("div", "card pad empty", "Nothing for sale yet. Publish something from Today."),
    el("span", "hint", approved.length ? `${approved.length} ${approved.length === 1 ? "publication" : "publications"}${live.state === "online" ? " · confirmed on your node" : ""}` : "")));
  if (revoked.length) parts.push(section("Taken down", card(revoked.map((item) => row(item.title, item.topic, chip("Revoked"))))));
  const sales = el("div", "card pad");
  sales.style.display = "flex";
  sales.style.justifyContent = "space-between";
  sales.style.gap = "16px";
  sales.append(el("span", "empty", "Nothing sold yet. Buyers' agents pay per call; the first one shows up here with what it paid."));
  parts.push(section("Sales", sales));
  return parts;
}

/** @param {Snapshot} s */
function renderSettings(s) {
  const provider = auth?.credentials[0];
  const [providerName, icon] = provider ? PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (provider.providerId)] ?? [provider.providerId, ""] : ["No one", ""];
  const value = (/** @type {(string | HTMLElement)[]} */ ...parts) => {
    const node = el("div", "v");
    node.append(...parts);
    return node;
  };
  const status = (/** @type {boolean} */ ok, /** @type {string} */ label) => {
    const node = el("span");
    node.style.display = "inline-flex";
    node.style.alignItems = "center";
    node.style.gap = "8px";
    node.append(el("span", `dot ${ok ? "ok" : ""}`), document.createTextNode(label));
    return node;
  };
  const sources = s.library.sources.map((source) =>
    row(source.label, source.enabled ? `${source.imported} ${source.imported === 1 ? "memory" : "memories"} imported` : "Not connected", value(status(source.enabled, source.enabled ? "Connected" : "Off")), false)
  );
  sources.push(row("How often Lore reads them", "New memories are written from what your agents learned.", value(status(s.setup.profile_configured, s.setup.profile_configured ? "Set" : "Not set"), ...(s.setup.profile_configured ? [] : [button("Start", "secondary", startSetup)])), false));
  const live = s.node.live;
  return [
    section("Account", card((auth?.credentials.length ? auth.credentials : [null]).map((credential) => {
      const [name, icon] = credential ? PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (credential.providerId)] ?? [credential.providerId, ""] : ["No one", ""];
      const trailing = value(name);
      if (icon) {
        const img = el("img");
        img.src = icon;
        img.alt = "";
        img.width = 14;
        img.height = 14;
        trailing.prepend(img);
      }
      if (credential) trailing.append(button("Sign out", "quiet", () => signOut(credential.providerId)));
      return row(`Signed in with ${name}`, credential?.type === "api_key" ? "An API key on this Mac reads and writes your memories with you." : "Your subscription reads and writes your memories with you.", trailing, false);
    }))),
    section("Where memories come from", card(sources)),
    section("What Lore keeps", card([
      row("Lore's shape", "What it keeps, what it ignores, what it may sell. Set in a short conversation.", value(status(s.setup.blueprint_configured, s.setup.blueprint_configured ? "Set" : "Not set"), ...(s.setup.blueprint_configured ? [] : [button("Start", "secondary", startSetup)])), false),
      row("Where it lives", "Everything stays on this Mac. Only what you approve for sale ever leaves.", value(Object.assign(el("span", "mono", s.home), { style: "color: var(--muted)" })), false)
    ])),
    section("Your store", card([
      row("Address", s.node.url ? s.node.url.replace(/^https?:\/\//, "").replace(/\/mcp$/, "") : "Not opened yet.", value(status(live.state === "online", live.state === "online" ? `Live on ${networkLabel(live.network) || "your node"}` : nodeLabel(live.state))), false),
      row("Prices", "What a buyer's agent pays per call.", value(Object.assign(el("span", "mono", `${price(s.pricing.publication_usd)} publication${s.pricing.answer_enabled ? ` · ${price(s.pricing.answer_usd)} answer` : ""}`), {})), false)
    ]))
  ];
}

const renderers = { today: renderToday, memories: renderMemories, store: renderStore, settings: renderSettings };

function render() {
  const heading = { today: greeting(), memories: "Memories", store: "Store", settings: "Settings" }[view];
  eyebrow.textContent = view === "today" ? longDate.format(new Date()) : "";
  title.textContent = heading;
  captureArea.hidden = view !== "today";
  for (const nav of navButtons) nav.setAttribute("aria-pressed", String(nav.dataset.view === view));
  if (!snapshot) return;
  $("[data-count=memories]").textContent = String(snapshot.library.counts.private);
  $("[data-count=store]").textContent = String(snapshot.publications.counts.active);
  content.replaceChildren(...renderers[view](snapshot));
  renderAccount();
}

function renderAccount() {
  account.replaceChildren();
  const provider = auth?.credentials[0];
  if (!provider) return;
  const [name, icon] = PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (provider.providerId)] ?? [provider.providerId, ""];
  const who = el("div", "who");
  who.append(el("b", "", "Signed in"));
  const line = el("span");
  if (icon) {
    const img = el("img");
    img.src = icon;
    img.alt = "";
    line.append(img);
  }
  const store = snapshot ? nodeLabel(snapshot.node.live.state) : "";
  line.append(document.createTextNode(`${name}${store ? ` · ${store === "Not set up" ? "Setting up" : store}` : ""}`));
  who.append(line);
  account.append(mark(), who);
}

/** @param {View} next */
function show(next) {
  view = next;
  if (next !== "memories") { hits = null; search.value = ""; }
  render();
  $("#main").focus();
}

async function load() {
  status.textContent = snapshot ? "" : "Loading…";
  try {
    [snapshot, candidates] = await Promise.all([window.lore.snapshot(), window.lore.candidates().catch(() => [])]);
    status.textContent = "";
    if (task === "setup" && snapshot.setup.profile_configured) task = "capture";
    render();
  } catch {
    status.textContent = "";
    const error = el("section", "card error");
    error.setAttribute("role", "alert");
    error.append(el("h2", "", "Lore could not load"), el("p", "hint", "Your data was not changed. Check that Lore is installed, then try again."), button("Try again", "secondary", load));
    content.replaceChildren(error);
  }
}

/** @param {string} text */
function say(text) {
  lines.push(text);
  while (lines.length > 6) lines.shift();
  liveText = "";
  renderLog();
}

/** @param {string} text */
function live(text) {
  liveText = text;
  renderLog();
}

function renderLog() {
  log.replaceChildren(...lines.map((text) => {
    const line = el("div", "line");
    line.append(mark("mark mark-sm"), el("p", "", text));
    return line;
  }));
  if (liveText) {
    const line = el("div", "line live");
    line.append(mark("mark mark-sm"), el("p", "", liveText));
    log.append(line);
  }
  agentPanel.hidden = !lines.length && !liveText && !requestSlot.childElementCount;
}

/** @param {boolean} active */
function working(active) {
  input.disabled = active;
  submit.disabled = active;
  composer.classList.toggle("working", active);
  if (active) {
    const pill = el("span", "pill");
    pill.append(el("i"), document.createTextNode({ setup: "Lore is thinking…", publish: "Lore is drafting…", capture: "Lore is reading this…" }[task]));
    status.replaceChildren(pill);
  } else {
    status.replaceChildren();
  }
}

/** @param {AgentRequest} event */
function renderRequest(event) {
  const box = el("form", "card lead request");
  if (event.type === "bash-approval") {
    const { action } = event;
    const decide = (/** @type {string} */ no, /** @type {string} */ yes, /** @type {string} */ hint) => {
      const actions = el("div", "actions");
      actions.style.justifyContent = "space-between";
      actions.style.alignItems = "center";
      const group = el("div");
      group.style.display = "flex";
      group.style.gap = "8px";
      group.append(button(no, "secondary", () => respond(event.id, false)), button(yes, "primary", () => respond(event.id, true)));
      actions.append(el("span", "hint", hint), group);
      box.append(actions);
    };
    const fields = (/** @type {Array<[string, unknown]>} */ pairs) => {
      const list = el("dl", "fields");
      for (const [label, value] of pairs) {
        const text = Array.isArray(value) ? value.join(", ") : value ? String(value) : "";
        if (text) list.append(el("dt", "", label), el("dd", "", text));
      }
      box.append(list);
    };
    if (action.kind === "capture") {
      const n = action.entries.length;
      box.append(el("p", "q", n === 1 ? "Keep this memory?" : `Keep these ${n} memories?`));
      const list = el("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "10px";
      for (const entry of action.entries) {
        const memory = el("div", "memory");
        memory.append(el("b", "", entry.title), el("p", "", entry.content));
        if (entry.project) {
          const meta = el("div", "meta");
          meta.append(chip(entry.project));
          memory.append(meta);
        }
        list.append(memory);
      }
      box.append(list);
      decide("Not now", n === 1 ? "Keep it" : "Keep all", "Private. Only on this Mac until you choose to sell.");
    } else if (action.kind === "import") {
      box.append(el("p", "q", "Import what Claude Code and Codex already remember?"));
      decide("Not now", "Import", "Private. Lore reads their memory files and never changes them.");
    } else if (action.kind === "blueprint") {
      const f = action.fields;
      box.append(el("p", "q", "Use this shape for your Lore?"));
      fields([["Name", f.name], ["Told as", f.persona], ["Organized by", f.organizing_axis], ["Topics", f.topic_outline], ["In depth", f.focus_topics], ["Lightly", f.general_areas], ["Voice", f.storytelling]]);
      decide("Not yet", "Use it", "You can reshape it any time from Settings.");
    } else if (action.kind === "profile") {
      const f = action.fields;
      const hour = clock.format(new Date(2000, 0, 1, typeof f.hour === "number" ? f.hour : 21)).toLowerCase();
      box.append(el("p", "q", `Finish setup and start writing memories ${f.cadence === "weekly" ? "every week" : "every day"} at ${hour}?`));
      fields([["You", f.role], ["Domains", f.domains], ["Worth keeping", f.valuable_context], ["How you work", f.preferences], ["Never kept", f.boundaries], ["Written by", `${f.executor === "codex" ? "Codex" : "Claude Code"}${f.model ? ` (${f.model})` : ""}`]]);
      decide("Not yet", "Finish setup", "Runs on this Mac. Every new memory stays private until you sell it.");
    } else {
      box.append(el("p", "q", "Lore wants to run this"), el("pre", "", event.command));
      decide("Deny", "Allow once", "");
    }
  } else if (event.type === "question") {
    for (const [index, question] of event.questions.entries()) {
      const fieldset = el("fieldset");
      fieldset.dataset.question = question.question;
      fieldset.append(el("legend", "q", question.question));
      const choices = el("div", "choices");
      for (const option of question.options) {
        const label = el("label", "choice");
        const pick = el("input");
        pick.type = question.multiSelect ? "checkbox" : "radio";
        pick.name = `question-${index}`;
        pick.value = option.label;
        label.append(pick, el("span", "", option.label));
        if (option.description) label.append(el("small", "", option.description));
        choices.append(label);
      }
      fieldset.append(choices);
      const other = el("input", "other-answer");
      other.type = "text";
      other.placeholder = "Or type your answer";
      fieldset.append(other);
      box.append(fieldset);
    }
    const actions = el("div", "actions");
    const go = el("button", "btn primary sm", "Continue");
    go.type = "submit";
    actions.append(go);
    box.append(actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      /** @type {Record<string, string>} */
      const answers = {};
      for (const fieldset of box.querySelectorAll("fieldset")) {
        const picked = [...fieldset.querySelectorAll("input:checked")].map((node) => /** @type {HTMLInputElement} */ (node).value);
        const other = /** @type {HTMLInputElement} */ (fieldset.querySelector(".other-answer"));
        if (fieldset.dataset.question) answers[fieldset.dataset.question] = other.value.trim() || picked.join(", ");
      }
      respond(event.id, answers);
    });
  } else {
    box.append(el("p", "q", event.prompt.message));
    /** @type {HTMLInputElement | HTMLSelectElement} */
    let field;
    if (event.prompt.type === "select") {
      field = el("select");
      for (const option of event.prompt.options) {
        const item = el("option", "", option.label);
        item.value = option.id;
        field.append(item);
      }
    } else {
      field = el("input");
      field.type = event.prompt.type === "secret" ? "password" : "text";
      field.placeholder = event.prompt.placeholder || "";
    }
    const actions = el("div", "actions");
    const go = el("button", "btn primary sm", "Continue");
    go.type = "submit";
    actions.append(go);
    box.append(field, actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const value = field.value;
      field.value = "";
      respond(event.id, value);
    });
  }
  box.dataset.id = event.id;
  requestSlot.replaceChildren(box);
  agentPanel.hidden = false;
  if (view !== "today") show("today");
  /** @type {HTMLElement | null} */ (box.querySelector("input[type=text], input[type=password], select"))?.focus();
}

/** @param {string} id @param {unknown} value */
async function respond(id, value) {
  requestSlot.replaceChildren();
  renderLog();
  await window.lore.respond({ id, value });
}

async function startSetup() {
  task = "setup";
  show("today");
  await send("Let's set up my Lore.");
}

async function startPublish() {
  task = "publish";
  show("today");
  await send("Help me publish something from my Lore.");
  task = "capture";
}

function approvals() {
  const list = el("div", "card pad");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "10px";
  for (const candidate of candidates) {
    const memory = el("div", "memory");
    memory.append(el("b", "", candidate.title));
    for (const [label, text] of [["Free teaser, what buyers see first", candidate.teaser], ["Paid content, what a buyer's agent gets", candidate.content]]) {
      memory.append(el("span", "hint", label), el("p", "", text));
    }
    const meta = el("div", "meta");
    meta.append(chip(candidate.topic));
    if (candidate.kind === "content") meta.append(chip("Verbatim"));
    const group = el("div");
    group.style.display = "flex";
    group.style.gap = "8px";
    group.style.marginLeft = "auto";
    group.append(button("Skip", "secondary", () => decide(candidate, false)), button("Approve", "primary", () => decide(candidate, true)));
    meta.append(group);
    memory.append(meta);
    list.append(memory);
  }
  return list;
}

function seamCard() {
  const box = el("div", "card lead request");
  box.append(el("p", "q", "Push to your store now?"), el("p", "hint", pushOffer || ""));
  const actions = el("div", "actions");
  actions.append(button("Leave it for now", "secondary", () => { pushOffer = false; render(); }), button("Push now", "primary", () => act(window.lore.push)));
  box.append(actions);
  return box;
}

/** @param {PublicationCandidate} candidate @param {boolean} approve */
async function decide(candidate, approve) {
  if ((await act(() => window.lore.decide({ candidate, approve }))) && approve) approvedThisPass = true;
  if (candidates.length || !approvedThisPass) return;
  approvedThisPass = false;
  pushOffer = snapshot?.node.url ? "Approved publications reach buyers only after a push. Leaving it is fine; the next push carries it." : false;
  if (!pushOffer) say("Approved. It goes on sale the moment you open a store.");
  render();
}

/** @param {() => Promise<void>} action */
async function act(action) {
  pushOffer = false;
  let done = true;
  try {
    await action();
  } catch (error) {
    done = false;
    say(error instanceof Error ? error.message : "Lore could not do that.");
  }
  await load();
  return done;
}

/** @param {string} text */
async function send(text) {
  const files = attachments.length ? `\n\nFiles to read:\n${attachments.map((path) => `- ${path}`).join("\n")}` : "";
  attachments = [];
  renderAttachments();
  try {
    await window.lore.prompt({ text: text + files, task });
    await load();
  } catch (error) {
    say(error instanceof Error ? error.message : "Something went wrong.");
  }
}

function renderAttachments() {
  attachmentList.replaceChildren(...attachments.map((path, index) => {
    const node = el("span", "attachment", path.split("/").pop());
    const remove = el("button", "", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${path}`);
    remove.addEventListener("click", () => { attachments.splice(index, 1); renderAttachments(); });
    node.append(remove);
    return node;
  }));
}

/** @param {string} providerId @param {"oauth" | "api_key"} type @param {string} [secret] */
async function signIn(providerId, type, secret) {
  welcomeNote.textContent = type === "oauth" ? "Waiting for your browser…" : "Checking your key…";
  try {
    auth = await window.lore.login({ providerId, type, secret });
    welcomeNote.textContent = "";
    enter();
  } catch (error) {
    welcomeNote.textContent = error instanceof Error ? error.message : "Sign-in didn't complete.";
  }
}

/** @param {string} providerId */
async function signOut(providerId) {
  auth = await window.lore.logout(providerId);
  enter();
}

function enter() {
  const signedIn = Boolean(auth?.credentials.length);
  welcome.hidden = signedIn;
  appShell.hidden = !signedIn;
  document.body.dataset.state = signedIn ? "app" : "welcome";
  if (signedIn) { render(); void load(); }
}

window.lore.onAgentEvent((event) => {
  if (event.type === "working") { working(event.active); if (!event.active) live(""); }
  else if (event.type === "live") live(event.text);
  else if (event.type === "changed") void load();
  else if (event.type === "message") say(event.text);
  else if (event.type === "progress") {
    if (event.done) {
      welcome.classList.remove("provisioning");
      welcomeNote.textContent = "";
      boot();
    } else {
      welcome.classList.add("provisioning");
      welcomeNote.textContent = event.error ?? event.text ?? "";
      if (!auth) { auth = { credentials: [], busy: false }; enter(); }
    }
  } else if (event.type === "dismiss") {
    if (/** @type {HTMLElement | null} */ (requestSlot.firstElementChild)?.dataset.id === event.id) { requestSlot.replaceChildren(); renderLog(); }
  } else if (event.type === "auth") {
    const detail = event.event;
    welcomeNote.textContent = event.message || (detail?.type === "device_code" ? `Open ${detail.verificationUri} and enter ${detail.userCode}.` : detail && "message" in detail ? detail.message : "Continue signing in.");
  } else renderRequest(event);
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text && !attachments.length) return;
  input.value = "";
  input.style.height = "";
  await send(text || "Please read the attached files.");
});
input.addEventListener("input", () => {
  input.style.height = "";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
});
const DICTATE_HINT = "Press the dictation key on your keyboard (or fn twice), then speak. Lore listens to whatever lands in the box.";
$("#dictate").addEventListener("click", () => {
  input.focus();
  if (lines.at(-1) !== DICTATE_HINT) say(DICTATE_HINT);
});
const GUARDED = /(^|\/)\.[^/]*$|\/\.(ssh|aws|gnupg)\/|\.(pem|key|p12|pfx|keychain(-db)?)$|id_(rsa|ed25519|ecdsa)/;
/** @param {string[]} paths */
function attach(paths) {
  for (const path of paths) {
    if (attachments.includes(path)) continue;
    if (GUARDED.test(path)) {
      say(`${path.split("/").pop()} looks like a credential or hidden file, so Lore won't read it. Rename or copy it first if you really mean to.`);
      continue;
    }
    attachments.push(path);
  }
  renderAttachments();
}
$("#attach").addEventListener("click", async () => attach(await window.lore.pickFiles()));
for (const type of ["dragenter", "dragover"]) {
  document.addEventListener(type, (event) => { event.preventDefault(); composer.classList.add("dropping"); });
}
document.addEventListener("dragleave", (event) => { if (!event.relatedTarget) composer.classList.remove("dropping"); });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  composer.classList.remove("dropping");
  attach([...(event.dataTransfer?.files ?? [])].map((file) => window.lore.pathFor(file)).filter(Boolean));
  if (attachments.length) show("today");
});

for (const nav of navButtons) nav.addEventListener("click", () => show(/** @type {View} */ (nav.dataset.view)));
let searchTimer = 0;
let searchSeq = 0;
search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  const query = search.value.trim();
  const seq = ++searchSeq;
  searchTimer = window.setTimeout(async () => {
    const found = query ? await window.lore.search(query) : null;
    if (seq !== searchSeq) return;
    hits = found;
    view = "memories";
    render();
  }, 250);
});
$("#search-form").addEventListener("submit", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search.focus(); search.select(); }
  if (event.key === "Escape" && document.querySelector(".sheet")) { event.preventDefault(); closeSheet(); }
});

for (const node of document.querySelectorAll("[data-login]")) {
  node.addEventListener("click", () => {
    const [providerId, type] = /** @type {string} */ (/** @type {HTMLElement} */ (node).dataset.login).split(":");
    void signIn(providerId, /** @type {"oauth" | "api_key"} */ (type));
  });
}
$("#welcome-key").addEventListener("click", () => { keyForm.hidden = false; /** @type {HTMLInputElement} */ ($("#key-secret")).focus(); });
keyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const secret = /** @type {HTMLInputElement} */ ($("#key-secret"));
  const provider = /** @type {HTMLSelectElement} */ ($("#key-provider")).value;
  const value = secret.value;
  secret.value = "";
  void signIn(provider, "api_key", value);
});

Object.assign(window, { __lore: { show, preview: renderRequest, signIn: () => { auth = { credentials: [{ providerId: "anthropic", type: "oauth" }], busy: false }; enter(); } } });

function boot() {
  window.lore.agentStatus().then((result) => { auth = result; enter(); }).catch(() => { auth = { credentials: [], busy: false }; enter(); });
}

boot();
