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
/** @type {string[]} */
const lines = [];
let firstRunDismissed = false;

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
  if (!s.setup.sources_configured) add("Connect your agents", "Let Lore read what Claude Code and Codex already remember.", button("Start", "secondary", startSetup));
  if (!s.setup.blueprint_configured) add("Tell Lore what it's for", "A five-minute conversation shapes what Lore keeps and what it sells.", button("Start", "secondary", startSetup));
  if (!s.setup.profile_configured) add("Choose how Lore learns from your agents", "Decide which model writes new memories, and how often.", button("Start", "secondary", startSetup));
  const changed = s.publications.items.filter((item) => item.needs_review).length;
  if (changed) {
    add(
      `${changed} ${changed === 1 ? "thing" : "things"} you sell ${changed === 1 ? "has" : "have"} changed underneath`,
      "The memories behind them were edited since you approved them.",
      button("Review", "secondary", () => show("store"))
    );
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
function renderToday(s) {
  const fresh = !firstRunDismissed && s.library.counts.private === 0 && !s.setup.blueprint_configured && !s.setup.profile_configured;
  /** @type {HTMLElement[]} */
  const parts = [];
  if (fresh) parts.push(firstRun(s));
  const attention = fresh ? [] : needsYou(s);
  if (attention.length) parts.push(section("Needs you", card(attention)));
  const recent = s.library.items.filter((item) => item.status === "private").slice(0, 5);
  const all = el("button", "", `All ${s.library.counts.private} →`);
  all.type = "button";
  all.addEventListener("click", () => show("memories"));
  parts.push(section("Recently kept", recent.length
    ? card(recent.map((item) => row(item.title, [item.project_label, when(item.updated_at)].filter(Boolean).join(" · "), chip("Private"))))
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
    ? hits.map((hit) => row(hit.title, [hit.project, when(hit.updated_at)].filter(Boolean).join(" · "), chip("Private")))
    : s.library.items.filter((item) => item.status === "private").map((item) => row(item.title, [item.project_label, when(item.updated_at)].filter(Boolean).join(" · "), chip("Private")));
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
  const changed = approved.filter((item) => item.needs_review);
  const revoked = s.publications.items.filter((item) => item.state === "revoked");
  /** @param {PublicationItem} item */
  const state = (item) => item.needs_review ? chip("Changed", "warn") : item.live === true ? chip("Live", "ok") : item.live === false ? chip("Not live yet") : chip("Approved");
  /** @type {HTMLElement[]} */
  const parts = [bar];
  if (changed.length) parts.push(section("Needs you", card(changed.map((item) => row(item.title, "The memory behind this changed after you approved it. Re-approve or take it down from Lore.", chip("Changed", "warn"))))));
  parts.push(section("For sale", approved.length
    ? card(approved.map((item) => row(item.title, item.topic, state(item))))
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
  const accountValue = value(providerName);
  if (icon) {
    const img = el("img");
    img.src = icon;
    img.alt = "";
    img.width = 14;
    img.height = 14;
    accountValue.prepend(img);
  }
  if (provider) accountValue.append(button("Sign out", "quiet", () => signOut(provider.providerId)));
  const sources = s.library.sources.map((source) =>
    row(source.label, source.enabled ? `${source.imported} ${source.imported === 1 ? "memory" : "memories"} imported` : "Not connected", value(status(source.enabled, source.enabled ? "Connected" : "Off")), false)
  );
  sources.push(row("How often Lore reads them", "New memories are written from what your agents learned.", value(status(s.setup.profile_configured, s.setup.profile_configured ? "Set" : "Not set"), ...(s.setup.profile_configured ? [] : [button("Start", "secondary", startSetup)])), false));
  const live = s.node.live;
  return [
    section("Account", card([row(`Signed in with ${providerName}`, "Your subscription reads and writes your memories with you.", accountValue, false)])),
    section("Where memories come from", card(sources)),
    section("What Lore keeps", card([
      row("Lore's shape", "What it keeps, what it ignores, what it may sell. Set in a short conversation.", value(status(s.setup.blueprint_configured, s.setup.blueprint_configured ? "Set" : "Not set"), ...(s.setup.blueprint_configured ? [] : [button("Start", "secondary", startSetup)])), false),
      row("Where it lives", "Everything stays on this Mac. Only what you approve for sale ever leaves.", value(Object.assign(el("span", "mono", s.home), { style: "color: var(--muted)" })), false)
    ])),
    section("Your store", card([
      row("Your store", s.node.url ? s.node.url.replace(/^https?:\/\//, "").replace(/\/mcp$/, "") : "Not opened yet.", value(status(live.state === "online", live.state === "online" ? `Live on ${networkLabel(live.network) || "your node"}` : nodeLabel(live.state))), false),
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
    snapshot = await window.lore.snapshot();
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
  renderLog();
}

function renderLog() {
  log.replaceChildren(...lines.map((text) => {
    const line = el("div", "line");
    line.append(mark("mark mark-sm"), el("p", "", text));
    return line;
  }));
  agentPanel.hidden = !lines.length && !requestSlot.childElementCount;
}

/** @param {boolean} active */
function working(active) {
  input.disabled = active;
  submit.disabled = active;
  composer.classList.toggle("working", active);
  if (active) {
    const pill = el("span", "pill");
    pill.append(el("i"), document.createTextNode(task === "setup" ? "Lore is thinking…" : "Lore is reading this…"));
    status.replaceChildren(pill);
  } else {
    status.replaceChildren();
  }
}

/** @param {AgentRequest} event */
function renderRequest(event) {
  const box = el("form", "card lead request");
  if (event.type === "bash-approval") {
    if (event.entries.length) {
      const n = event.entries.length;
      box.append(el("p", "q", n === 1 ? "Keep this memory?" : `Keep these ${n} memories?`));
      const list = el("div");
      list.style.display = "flex";
      list.style.flexDirection = "column";
      list.style.gap = "10px";
      for (const entry of event.entries) {
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
      const actions = el("div", "actions");
      actions.style.justifyContent = "space-between";
      actions.style.alignItems = "center";
      const group = el("div");
      group.style.display = "flex";
      group.style.gap = "8px";
      group.append(button("Not now", "secondary", () => respond(event.id, false)), button(n === 1 ? "Keep it" : "Keep all", "primary", () => respond(event.id, true)));
      actions.append(el("span", "hint", "Private. Only on this Mac until you choose to sell."), group);
      box.append(actions);
    } else {
      box.append(el("p", "q", "Lore wants to run this"), el("pre", "", event.command));
      const actions = el("div", "actions");
      actions.append(button("Deny", "secondary", () => respond(event.id, false)), button("Allow once", "primary", () => respond(event.id, true)));
      box.append(actions);
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
        label.append(pick, document.createTextNode(option.label));
        if (option.description) label.append(el("small", "", ` — ${option.description}`));
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
  if (event.type === "working") working(event.active);
  else if (event.type === "message") say(event.text);
  else if (event.type === "auth") {
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
$("#dictate").addEventListener("click", () => {
  input.focus();
  say("Press the dictation key on your keyboard (or fn twice), then speak. Lore listens to whatever lands in the box.");
});
$("#attach").addEventListener("click", async () => {
  attachments.push(...(await window.lore.pickFiles()).filter((path) => !attachments.includes(path)));
  renderAttachments();
});
for (const type of ["dragenter", "dragover"]) {
  document.addEventListener(type, (event) => { event.preventDefault(); composer.classList.add("dropping"); });
}
document.addEventListener("dragleave", (event) => { if (!event.relatedTarget) composer.classList.remove("dropping"); });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  composer.classList.remove("dropping");
  for (const file of event.dataTransfer?.files ?? []) {
    const path = window.lore.pathFor(file);
    if (path && !attachments.includes(path)) attachments.push(path);
  }
  renderAttachments();
  if (attachments.length) show("today");
});

for (const nav of navButtons) nav.addEventListener("click", () => show(/** @type {View} */ (nav.dataset.view)));
let searchTimer = 0;
search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  const query = search.value.trim();
  searchTimer = window.setTimeout(async () => {
    hits = query ? await window.lore.search(query) : null;
    view = "memories";
    render();
  }, 250);
});
$("#search-form").addEventListener("submit", (event) => event.preventDefault());
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search.focus(); search.select(); }
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

Object.assign(window, { __lore: { show, preview: renderRequest } });

window.lore.agentStatus().then((result) => { auth = result; enter(); }).catch(() => { auth = { credentials: [], busy: false }; enter(); });
