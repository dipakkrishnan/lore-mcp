/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const welcome = $("#welcome");
const appShell = $("#app");
const welcomeNote = $("#welcome-note");
const welcomeRetry = /** @type {HTMLButtonElement} */ ($("#welcome-retry"));
const keyForm = /** @type {HTMLFormElement} */ ($("#key-form"));
const eyebrow = $("#eyebrow");
const title = $("#title");
const status = $("#status");
const content = $("#content");
const account = $("#account");
const taskBack = /** @type {HTMLButtonElement} */ ($("#task-back"));
const taskRestart = /** @type {HTMLButtonElement} */ ($("#task-restart"));
const captureArea = $("#capture");
const composer = /** @type {HTMLFormElement} */ ($("#composer"));
const input = /** @type {HTMLTextAreaElement} */ ($("#capture-input"));
const inputLabel = /** @type {HTMLLabelElement} */ (composer.querySelector("label"));
const attachmentList = $("#attachments");
const submit = /** @type {HTMLButtonElement} */ ($("#capture-submit"));
const agentPanel = $("#agent");
const detailSlot = $("#detail");
const log = $("#log");
const requestSlot = $("#request");
const search = /** @type {HTMLInputElement} */ ($("#search"));
const mainEl = $("#main");
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
/** @type {TaskRecord[]} */
let taskItems = [];
/** @type {AgentTask | null} */
let detailTask = null;
/** @type {TaskRecord | null} */
let detailRecord = null;
/** @type {string[]} */
let attachments = [];
/** @type {SearchHit[] | null} */
let hits = null;
let liveText = "";
let previewSignIn = false;
/** @type {Line[]} */
const lines = [];
/** @type {PublicationCandidate[]} */
let candidates = [];
let approvedThisPass = false;
/** @type {string | false} */
let pushOffer = false;
let pushing = false;
/** @type {string | false} */
let pushedNote = false;
let accountMenuOpen = false;
/** The task whose turn is open, while one is. @type {AgentTask | null} */
let busy = null;
/** The card awaiting the owner. A memory card also carries `current`, its entries as edited, so the composer can send a spoken or typed correction with them. @type {{id: string, task: AgentTask | null, box: HTMLElement, current?: () => ProposedMemory[]} | null} */
let request = null;

const RING = `<svg viewBox="0 0 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M13 4.5a8.5 8.5 0 1 1-6 2.5"></path><path d="M13 9a4 4 0 1 1-2.8 1.2"></path><circle cx="13" cy="13" r="1.2" fill="currentColor" stroke="none"></circle></svg>`;
const PROVIDERS = {
  anthropic: ["Claude", "assets/claude.svg"],
  "openai-codex": ["ChatGPT", "assets/openai.svg"],
  openai: ["OpenAI", "assets/openai.svg"]
};
const NETWORKS = { "eip155:8453": "Base", "eip155:84532": "Base Sepolia, test network" };
const TEST_NETWORK = "eip155:84532";
const CHANGE_PRICE = "I want to change the price on my store. Set the new price and redeploy so buyers pay the new amount.";
const REAL_MONEY = "I'm ready to switch my store to real money.";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const TASK_TITLES = { capture: "Capture a memory", setup: "Set up your Lore", publish: "Publish from your Lore", deploy: "Open your store" };
const TASK_STATES = { needs_you: "Needs you", working: "Working", stopped: "Stopped", done: "Done" };

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

/** @param {unknown} error @param {string} fallback */
function reason(error, fallback) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : fallback;
}

/** @param {HTMLTextAreaElement} area */
function fit(area) {
  area.style.height = "";
  area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
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

/** @param {string} label @param {string | HTMLElement} [detail] @param {HTMLElement} [trailing] @param {boolean} [serif] */
function row(label, detail, trailing, serif = true) {
  const node = el("div", "row");
  const text = el("div", "t");
  text.append(el("b", serif ? "" : "sans", label));
  if (detail) text.append(typeof detail === "string" ? el("span", "", detail) : detail);
  node.append(text);
  if (trailing) node.append(trailing);
  return node;
}

marked.use({ renderer: { html: () => "" } });
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n*/;

/** @param {string} text */
function markdown(text) {
  const node = el("div", "md");
  node.innerHTML = marked.parse(text, { async: false });
  for (const link of node.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
    else { link.target = "_blank"; link.rel = "noreferrer"; }
  }
  for (const image of node.querySelectorAll("img")) image.remove();
  return node;
}

/** @param {{id: number, title: string}} memory @param {AgentTask} [from] The thread the agent should continue from. */
async function publishMemory(memory, from) {
  closeSheet();
  await openTask("publish");
  // A pending draft for this memory, or the publish agent mid-draft, is the thread itself: open it, never start a second turn.
  if (busy === "publish" || candidates.some((candidate) => candidate.provenance.includes(memory.id))) return;
  await send(`Help me publish something from my Lore. Start from memory ${memory.id}: "${memory.title}".`, from);
}

/** @param {number | string} id @param {string} title @param {string} detail */
function memoryRow(id, title, detail) {
  const node = el("div", "row");
  const open = el("button", "task-link");
  open.type = "button";
  const text = el("div", "t");
  text.append(el("b", "", title), el("span", "", detail));
  open.append(text, chip("Private"));
  open.addEventListener("click", () => openMemory(Number(id)));
  node.append(open, button("Draft for sale", "quiet", () => void publishMemory({ id: Number(id), title })));
  return node;
}

/** Render a memory's content as markdown, pulling the description out of any frontmatter. @param {string} content */
function renderMemoryBody(content) {
  const meta = content.match(FRONTMATTER)?.[1] ?? "";
  const node = markdown(content.replace(FRONTMATTER, ""));
  node.classList.add("body");
  const description = meta.match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  if (description) node.prepend(el("p", "lede", description));
  return node;
}

/** @param {number} id */
async function openMemory(id) {
  /** @type {Memory} */
  let memory;
  try {
    memory = await window.lore.memory(id);
  } catch (error) {
    tell(reason(error, "Lore could not open that."), true);
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
  const actions = el("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  function showActions() {
    actions.replaceChildren(button("Edit", "quiet", startEdit), button("Draft for sale", "quiet", () => void publishMemory(memory)));
  }
  /** @type {HTMLElement} */
  let body = renderMemoryBody(memory.content);
  function startEdit() {
    const textarea = /** @type {HTMLTextAreaElement} */ (el("textarea", "body-edit"));
    textarea.value = memory.content;
    textarea.setAttribute("aria-label", "Memory content");
    body.replaceWith(textarea);
    textarea.focus();
    actions.replaceChildren(button("Cancel", "secondary", cancelEdit), button("Save", "primary", () => void saveEdit()));
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelEdit(); }
      else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void saveEdit(); }
    });
    function cancelEdit() {
      textarea.replaceWith(body);
      showActions();
    }
    async function saveEdit() {
      const value = textarea.value.trim();
      if (!value || value === memory.content) { cancelEdit(); return; }
      try {
        memory = await window.lore.editMemory(memory.id, value);
      } catch (error) {
        tell(reason(error, "Lore could not save that."), true);
        return;
      }
      body = renderMemoryBody(memory.content);
      textarea.replaceWith(body);
      showActions();
      void load();
    }
  }
  showActions();
  head.append(text, actions, close);
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

/** @param {string} url */
function workerConsole(url) {
  const host = new URL(url).hostname;
  if (!host.endsWith(".workers.dev")) return null;
  return `https://dash.cloudflare.com/?to=/:account/workers/services/view/${host.split(".")[0]}`;
}

/** @param {string} url */
function storeAddress(url) {
  const node = el("span", "address");
  node.append(el("span", "mono", url.replace(/^https?:\/\//, "").replace(/\/mcp$/, "")));
  const console = workerConsole(url);
  if (console) {
    const open = el("a", "link-btn", "Cloudflare ↗");
    open.href = console;
    open.target = "_blank";
    open.rel = "noreferrer";
    node.append(open);
  }
  return node;
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
  else if (!s.setup.blueprint_configured) add("Shape your Lore", "Review one proposal based on what your agents already know.", button("Start", "secondary", startSetup));
  else if (!s.setup.profile_configured) add("Set the rhythm", "Choose which model writes new memories, and how often.", button("Start", "secondary", startSetup));
  else {
    if (!s.node.url) add("Open your store", "A payout address, a price, and a node on the test network first. Free until you say otherwise.", button("Open", "secondary", () => void startDeploy()));
    if (s.library.counts.private && !candidates.length) add("Publish something", "Lore drafts up to three things to sell; you approve each one.", button("Publish", "secondary", startPublish));
  }
  // Approved work a buyer cannot see yet is actionable whatever rung setup is on.
  const waiting = unpushed(s);
  if (waiting.length && !pushOffer && !pushing) add("Push to your store", `${waiting.length} approved, not on your store yet.`, button("Push", "secondary", pushNow));
  return rows;
}

function displayTasks() {
  return taskItems.slice(0, 3);
}

function draftsPhase() {
  return `${candidates.length} ${candidates.length === 1 ? "draft" : "drafts"} to approve`;
}

/** @param {Snapshot} s */
function renderToday(s) {
  if (detailTask) {
    /** @type {HTMLElement[]} */
    const detailParts = [];
    if (detailTask === "publish" && candidates.length) detailParts.push(section("Approve what to sell", approvals(), el("span", "hint", "Only what you approve ever leaves this Mac.")));
    if (detailTask === "publish" && (pushOffer || pushing)) detailParts.push(seamCard());
    if (detailTask === "publish" && pushedNote) detailParts.push(pushReceipt(s));
    if ((detailTask === "setup" || detailTask === "deploy") && detailRecord?.state === "done") detailParts.push(nextRung(s));
    return detailParts;
  }
  /** @type {HTMLElement[]} */
  const parts = [];
  if (candidates.length) parts.push(section("Approve what to sell", approvals(), el("span", "hint", "Only what you approve ever leaves this Mac.")));
  if (pushOffer || pushing) parts.push(seamCard());
  if (pushedNote) parts.push(pushReceipt(s));
  const attention = needsYou(s);
  if (attention.length) parts.push(section("Needs you", card(attention)));
  const shown = displayTasks();
  if (shown.length) {
    parts.push(section("Unfinished", card(shown.map((item) => {
      const row = el("div", "row");
      const open = el("button", "task-link");
      open.type = "button";
      const text = el("div", "t");
      text.append(el("b", "", item.title), el("span", "", item.phase));
      open.append(text, chip(TASK_STATES[item.state], item.state === "working" ? "ok" : ""));
      open.addEventListener("click", () => void openTask(item.kind, item));
      row.append(open);
      if (item.state === "stopped") row.append(button("Start over", "quiet", () => void startOver(item.kind)));
      return row;
    }))));
  }
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
    text.append(storeAddress(s.node.url));
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
  if (unpushed(s).length && !pushOffer) {
    const push = button(pushing ? "Pushing…" : "Push to your store", "primary", pushNow);
    push.disabled = pushing;
    bar.append(push);
  }
  const approved = s.publications.items.filter((item) => item.state === "approved");
  const waiting = unpushed(s);
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
    el("span", "hint", approved.length ? `${approved.length} ${approved.length === 1 ? "publication" : "publications"}${live.state !== "online" ? "" : waiting.length ? ` · ${waiting.length} not on your store yet` : " · confirmed on your node"}` : "")));
  if (revoked.length) parts.push(section("Taken down", card(revoked.map((item) => row(item.title, item.topic, chip("Revoked"))))));
  const sales = el("div", "card pad");
  sales.style.display = "flex";
  sales.style.justifyContent = "space-between";
  sales.style.gap = "16px";
  sales.append(el("span", "empty", "Sales don't show up here yet. Buyers' agents pay per call, and each payment lands in the payout wallet you gave when you opened your store."));
  parts.push(section("Sales", sales));
  return parts;
}

/** @param {Snapshot} s */
function renderSettings(s) {
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
      row("Address", s.node.url ? storeAddress(s.node.url) : "Not opened yet.", value(status(live.state === "online", live.state === "online" ? `Live on ${networkLabel(live.network) || "your node"}` : nodeLabel(live.state))), false),
      row("Prices", "What a buyer's agent pays per call.", value(el("span", "mono", `${price(s.pricing.publication_usd)} publication${s.pricing.answer_enabled ? ` · ${price(s.pricing.answer_usd)} answer` : ""}`), ...(s.node.url ? [button("Change price", "quiet", () => void startDeploy(CHANGE_PRICE))] : [])), false),
      ...(live.network === TEST_NETWORK
        ? [row("Payments", "Buyers on the test network pay with play money. Switch when you want real buyers paying real money.", value(button("Switch to real payments", "secondary", () => void startDeploy(REAL_MONEY))), false)]
        : [])
    ]))
  ];
}

const renderers = { today: renderToday, memories: renderMemories, store: renderStore, settings: renderSettings };

function render() {
  const detail = view === "today" ? detailTask : null;
  const heading = detail ? detailRecord?.title ?? TASK_TITLES[detail] : { today: greeting(), memories: "Memories", store: "For Sale", settings: "Settings" }[view];
  const pendingDrafts = detail === "publish" && candidates.length;
  eyebrow.textContent = detail
    ? pendingDrafts ? `Needs you · ${draftsPhase()}` : `${TASK_STATES[detailRecord?.state ?? "working"]} · ${detailRecord?.phase ?? "Starting"}`
    : view === "today" ? longDate.format(new Date()) : "";
  title.textContent = heading;
  taskBack.hidden = !detail;
  taskRestart.hidden = !detail || detailRecord?.state !== "stopped";
  captureArea.hidden = view !== "today";
  log.hidden = !detail;
  syncComposer();
  for (const nav of navButtons) nav.setAttribute("aria-pressed", String(nav.dataset.view === view));
  if (!snapshot) return;
  $("[data-count=memories]").textContent = String(snapshot.library.counts.private);
  $("[data-count=store]").textContent = String(snapshot.publications.counts.active);
  const parts = renderers[view](snapshot);
  detailSlot.replaceChildren(...(detail ? parts : []));
  content.replaceChildren(...(detail ? [] : parts));
  for (const area of mainEl.querySelectorAll("textarea")) fit(/** @type {HTMLTextAreaElement} */ (area));
  renderAccount();
}

function renderAccount() {
  account.replaceChildren();
  const provider = auth?.credentials[0];
  if (!provider) return;
  const [name, icon] = PROVIDERS[/** @type {keyof typeof PROVIDERS} */ (provider.providerId)] ?? [provider.providerId, ""];
  const trigger = el("button", "account-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", String(accountMenuOpen));
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
  trigger.append(mark(), who);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
    renderAccount();
  });
  account.append(trigger);
  if (accountMenuOpen) {
    const menu = el("div", "account-menu");
    menu.setAttribute("role", "menu");
    const item = (/** @type {string} */ label, /** @type {() => void} */ onPick) => {
      const node = el("button", "", label);
      node.type = "button";
      node.setAttribute("role", "menuitem");
      node.addEventListener("click", () => { accountMenuOpen = false; onPick(); });
      return node;
    };
    menu.append(item("Open Settings", () => show("settings")), item(`Sign out of ${name}`, () => void signOut(provider.providerId)));
    account.append(menu);
    /** @type {HTMLElement | null} */ (menu.querySelector("button"))?.focus({ preventScroll: true });
  }
}

/** @param {View} next */
function show(next) {
  view = next;
  if (next !== "memories") { hits = null; search.value = ""; }
  render();
  mainEl.focus({ preventScroll: true });
}

async function load() {
  if (!snapshot) content.replaceChildren(el("p", "hint", "Loading…"));
  try {
    [snapshot, candidates, taskItems] = await Promise.all([window.lore.snapshot(), window.lore.candidates().catch(() => []), window.lore.tasks().catch(() => [])]);
    if (detailTask) detailRecord = taskItems.find((item) => item.kind === detailTask) ?? detailRecord;
    render();
  } catch {
    const error = el("section", "card error");
    error.setAttribute("role", "alert");
    error.append(el("h2", "", "Lore could not load"), el("p", "hint", "Your data was not changed. Check that Lore is installed, then try again."), button("Try again", "secondary", load));
    content.replaceChildren(error);
  }
}

/** @param {string} text @param {boolean} [owner] @param {boolean} [stopped] */
function say(text, owner = false, stopped = false) {
  lines.push({ text, owner, stopped });
  if (!owner) liveText = "";
  renderLog();
}

/** @type {Array<{text: string, attention: boolean}>} */
const notices = [];

/** Something Lore did or could not do, said where the owner is: in the open thread, or as a notice above the page when the log is hidden. @param {string} text @param {boolean} [attention] */
function tell(text, attention = false) {
  if (!log.hidden) { say(text, false, attention); return; }
  notices.push({ text, attention });
  if (notices.length > 3) notices.shift();
  renderNotices();
}

function renderNotices() {
  status.replaceChildren(...notices.map((item) => {
    const box = el("div", item.attention ? "notice attention" : "notice");
    const dismiss = el("button", "dismiss", "×");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.addEventListener("click", () => { notices.splice(notices.indexOf(item), 1); renderNotices(); });
    box.append(el("span", "", item.text), dismiss);
    return box;
  }));
}

/** @param {string} text */
function live(text) {
  liveText = text;
  renderLog();
}

/** What capture kept, with the one next step an owner may want. @param {SavedMemory[]} saved */
function savedCard(saved) {
  if (!saved.length) return el("p", "", "Nothing saved.");
  return card(saved.map((memory) => {
    // Only the capture thread offers the next step; a publish thread forked from it restores these same lines.
    const draft = detailTask === "capture" ? button("Draft for sale", "quiet", () => void publishMemory(memory, "capture")) : undefined;
    if (draft) draft.disabled = busy !== null;
    return row(memory.title, memory.status === "unchanged" ? "Already in your Lore" : "Saved, only on this Mac", draft);
  }));
}

/** The card that belongs in the open thread; a card from another thread waits there. */
function shownRequest() {
  return request && (!request.task || request.task === detailTask) ? request : null;
}

/** Derive the composer from what is on screen: a memory card keeps it open for corrections, any other card hides it, an open turn locks it. */
function syncComposer() {
  const shown = shownRequest();
  const card = shown?.current ? shown : null;
  const locked = busy !== null && !card;
  requestSlot.hidden = !shown;
  composer.hidden = (shown !== null && !card) || ((detailTask === "setup" || detailTask === "deploy") && detailRecord?.state === "done");
  input.disabled = locked;
  submit.disabled = locked;
  composer.classList.toggle("working", locked);
  input.placeholder = locked ? (request?.current ? "Lore is waiting on your capture…" : "Lore is working…") : card ? "Or say what to change…" : detailTask ? "Reply to Lore…" : "What did you learn today?";
  inputLabel.textContent = card ? "Say what to change" : detailTask ? "Reply to Lore" : "What did you learn today?";
  submit.textContent = detailTask ? "Send" : "Capture";
}

function clearRequest() {
  request = null;
  requestSlot.replaceChildren();
  syncComposer();
}

function renderLog() {
  log.replaceChildren(...lines.map(({ text, owner, stopped, saved }) => {
    const line = el("div", owner ? "line owner" : stopped ? "line stop" : "line");
    line.append(owner ? el("span", "you", "You") : mark("mark mark-sm"), saved ? savedCard(saved) : owner ? el("p", "", text) : markdown(text));
    return line;
  }));
  if (liveText) {
    const line = el("div", "line live");
    line.append(mark("mark mark-sm"), markdown(liveText));
    log.append(line);
  }
  agentPanel.hidden = !lines.length && !liveText && !shownRequest() && !detailSlot.childElementCount;
  if (log.lastElementChild) mainEl.scrollTop = mainEl.scrollHeight;
}

/** @param {AgentRequest} event */
function renderRequest(event) {
  const box = /** @type {HTMLFormElement} */ (el("form", "card lead request"));
  /** A memory card's entries as edited. @type {(() => ProposedMemory[]) | undefined} */
  let current;
  if (event.type === "question") {
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
      respond(event.id, answers, Object.values(answers).filter(Boolean).join(" · "));
    });
  } else if (event.type === "memories") {
    const list = el("div", "card pad stack");
    /** @type {Array<{entry: ProposedMemory, node: HTMLElement, title: HTMLInputElement | HTMLTextAreaElement, content: HTMLInputElement | HTMLTextAreaElement}>} */
    let drafts = [];
    const keep = el("button", "btn primary sm");
    keep.type = "submit";
    const relabel = () => { keep.textContent = drafts.length === 1 ? "Keep this memory" : "Keep these"; keep.disabled = !drafts.length; };
    for (const entry of event.entries) {
      const node = el("div", "memory");
      const title = draftField(node, "Title", entry.title, true);
      const content = draftField(node, "What to remember", entry.content);
      title.maxLength = 300;
      content.maxLength = 20_000;
      const meta = el("div", "meta");
      if (entry.project) meta.append(chip(entry.project));
      meta.append(button("Drop", "quiet", () => { drafts = drafts.filter((draft) => draft.node !== node); node.remove(); relabel(); }));
      node.append(meta);
      list.append(node);
      drafts.push({ entry, node, title, content });
    }
    relabel();
    const edited = () => drafts.map(({ entry, title, content }) => ({ ...entry, title: title.value.trim(), content: content.value.trim() }));
    current = edited;
    box.append(
      el("p", "q", event.entries.length === 1 ? "Keep this memory?" : "Keep these memories?"),
      el("p", "hint", "Edit anything here, or say what to change below. Nothing is saved until you keep it."),
      list
    );
    const actions = el("div", "actions");
    actions.append(button("Drop all", "secondary", () => respond(event.id, { entries: [] }, "Drop them")), keep);
    box.append(actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      for (const { title, content } of drafts) for (const field of [title, content]) field.setCustomValidity(field.value.trim() ? "" : "Write something here, or drop this memory.");
      if (!box.reportValidity()) return;
      respond(event.id, { entries: edited() }, drafts.length === 1 ? "Keep it" : "Keep these");
    });
  } else if (event.type === "blueprint") {
    box.append(el("p", "q", "Use this shape for your Lore?"), el("p", "hint", event.evidence));
    const inputs = el("div", "blueprint-fields");
    /** @type {Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */
    const controls = {};
    const add = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ value, grow = true) => {
      const field = el("label");
      field.append(el("span", "", label));
      /** @type {HTMLInputElement | HTMLTextAreaElement} */
      let inputField;
      if (grow) {
        inputField = el("textarea");
        inputField.rows = 1;
        inputField.addEventListener("input", () => fit(/** @type {HTMLTextAreaElement} */ (inputField)));
      } else {
        inputField = el("input");
        inputField.type = "text";
        enterMovesOn(inputField, inputs);
      }
      inputField.value = value;
      field.append(inputField);
      controls[key] = inputField;
      inputs.append(field);
    };
    add("name", "Name", event.fields.name, false);
    for (const [key, label] of [["persona", "Told as"], ["organizing_axis", "Organized by"]]) {
      const field = el("label");
      field.append(el("span", "", label));
      const select = el("select");
      const choices = key === "persona" ? ["storyteller", "schoolteacher", "professor", "executive", "sage"] : ["", "chronological", "theme", "project", "knowledge"];
      for (const choice of choices) {
        const option = el("option", "", choice || "persona default");
        option.value = choice;
        option.selected = choice === (/** @type {Record<string, unknown>} */ (event.fields)[key] ?? "");
        select.append(option);
      }
      field.append(select);
      controls[key] = select;
      inputs.append(field);
    }
    add("topic_outline", "Topics", event.fields.topic_outline.join(", "));
    add("focus_topics", "In depth", event.fields.focus_topics.join(", "));
    add("general_areas", "Lightly", event.fields.general_areas.join(", "));
    add("storytelling", "Voice", event.fields.storytelling);
    box.append(inputs);
    const actions = el("div", "actions");
    const use = el("button", "btn primary sm", "Use this shape");
    use.type = "submit";
    actions.append(use);
    box.append(actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const list = (/** @type {string} */ key) => controls[key].value.split(",").map((item) => item.trim()).filter(Boolean);
      const fields = {
        version: 1,
        name: controls.name.value.trim(),
        persona: controls.persona.value,
        ...(controls.organizing_axis.value ? { organizing_axis: controls.organizing_axis.value } : {}),
        topic_outline: list("topic_outline"),
        focus_topics: list("focus_topics"),
        general_areas: list("general_areas"),
        storytelling: controls.storytelling.value.trim()
      };
      respond(event.id, fields, `${fields.name} · ${fields.persona} · ${fields.topic_outline.join(", ")}`);
    });
  } else if (event.type === "cloudflare") {
    box.append(
      el("p", "q", "Sign in to Cloudflare?"),
      el("p", "hint", "Your browser will open Cloudflare's sign-in page; a free account is enough. Come back here once it says you can close the page.")
    );
    const actions = el("div", "actions");
    const later = el("button", "btn secondary sm", "Not now");
    later.type = "button";
    later.addEventListener("click", () => respond(event.id, false, "Not now"));
    const open = el("button", "btn primary sm", "Open Cloudflare");
    open.type = "submit";
    actions.append(later, open);
    box.append(actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      respond(event.id, true, "Open Cloudflare");
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
  request = { id: event.id, task: event.task, box, current };
  requestSlot.replaceChildren(box);
  agentPanel.hidden = false;
  syncComposer();
  if (view !== "today") show("today");
  for (const area of box.querySelectorAll("textarea")) fit(/** @type {HTMLTextAreaElement} */ (area));
  if (event.type === "question" || event.type === "memories" || event.type === "blueprint") {
    mainEl.scrollTop = Math.max(0, box.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop - 16);
  } else {
    mainEl.scrollTop = mainEl.scrollHeight;
    /** @type {HTMLElement | null} */ (box.querySelector("input[type=text], input[type=password], select"))?.focus({ preventScroll: true });
  }
}

/** @param {string} id @param {unknown} value @param {string} [echo] */
async function respond(id, value, echo) {
  clearRequest();
  if (echo) say(echo, true);
  else renderLog();
  await window.lore.respond({ id, value });
}

async function startSetup() {
  await openTask("setup");
  await send("Let's set up my Lore.");
}

/** @param {string} [intent] */
async function startDeploy(intent = "Help me open my store.") {
  await openTask("deploy");
  await send(intent);
}


/** @param {Snapshot} s */
function nextRung(s) {
  const box = el("div", "card lead request");
  const deploy = detailTask === "deploy";
  const storeOpen = Boolean(s.node.url);
  const heading = deploy ? (storeOpen ? "Your store is open." : "Your store isn't open yet.") : "Your Lore is set up.";
  const detail = deploy
    ? storeOpen
      ? "This thread is closed. Publications reach buyers after a push; everything else stays on this Mac."
      : "This thread is closed. Try again now, or any time from Today."
    : "This thread is closed. What comes next is a separate step — take it now, or any time from Today.";
  box.append(
    el("p", "q", heading),
    el("p", "hint", detail)
  );
  const actions = el("div", "actions");
  if (s.node.url) {
    const live = el("a", "btn secondary sm", "Your store ↗");
    live.href = s.node.url.replace(/\/mcp$/, "");
    live.target = "_blank";
    live.rel = "noreferrer";
    actions.append(live);
  } else {
    actions.append(button("Open your store", "secondary", () => void startDeploy()));
  }
  actions.append(button("Publish something", "primary", () => void startPublish()));
  box.append(actions);
  return box;
}

async function startPublish() {
  await openTask("publish");
  await send("Help me publish something from my Lore.");
}

/** @param {AgentTask} kind @param {TaskRecord} [record] */
async function openTask(kind, record) {
  task = kind;
  detailTask = kind;
  detailRecord = record ?? taskItems.find((item) => item.kind === kind) ?? null;
  lines.splice(0, lines.length, ...(detailRecord ? await window.lore.history(kind).catch(() => []) : []));
  liveText = "";
  show("today");
  renderLog();
}

/** @param {AgentTask} kind */
async function startOver(kind) {
  await window.lore.restart(kind);
  task = kind;
  detailTask = kind;
  detailRecord = null;
  lines.splice(0);
  liveText = "";
  clearRequest();
  show("today");
  renderLog();
  input.focus({ preventScroll: true });
}

function closeTask() {
  detailTask = null;
  detailRecord = null;
  task = "capture";
  lines.splice(0);
  liveText = "";
  renderLog();
  render();
}

/** An editable field on a draft card. @param {HTMLElement} parent @param {string} label @param {string} value @param {boolean} [singleLine] */
function draftField(parent, label, value, singleLine = false) {
  const wrapper = el("label", "draft-field");
  wrapper.append(el("span", "hint", label));
  const control = singleLine ? el("input", "draft-title") : el("textarea");
  if (control instanceof HTMLInputElement) { control.type = "text"; enterMovesOn(control, parent); }
  else { control.rows = 1; control.addEventListener("input", () => fit(control)); }
  control.value = value;
  wrapper.append(control);
  parent.append(wrapper);
  return control;
}

/** Enter in a one-line field moves to the next field instead of submitting the card. @param {HTMLInputElement} field @param {HTMLElement} within */
function enterMovesOn(field, within) {
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    /** @type {HTMLElement | null} */ (within.querySelector("textarea, select"))?.focus();
  });
}

/** Approval forms outlive renders, so edits survive the agent's next event. @type {Map<string, HTMLElement>} */
const approvalForms = new Map();

function approvals() {
  const list = el("div", "card pad stack");
  const shown = new Set();
  for (const candidate of candidates) {
    const key = JSON.stringify(candidate);
    shown.add(key);
    const form = approvalForms.get(key) ?? approvalForm(candidate);
    approvalForms.set(key, form);
    list.append(form);
  }
  for (const key of approvalForms.keys()) if (!shown.has(key)) approvalForms.delete(key);
  return list;
}

/** @param {PublicationCandidate} candidate */
function approvalForm(candidate) {
  const memory = el("div", "memory");
  const title = draftField(memory, "Title", candidate.title, true);
  const teaser = draftField(memory, "Free teaser, what buyers see first", candidate.teaser);
  const paid = draftField(memory, "Paid content, what a buyer's agent gets", candidate.content);
  const meta = el("div", "meta");
  meta.append(chip(candidate.topic));
  if (candidate.kind === "content") meta.append(chip("Verbatim"));
  const group = el("div", "group");
  group.append(
    button("Skip", "secondary", () => decide(candidate, false)),
    button("Approve", "primary", () => decide(candidate, true, { ...candidate, title: title.value, teaser: teaser.value, content: paid.value }))
  );
  meta.append(group);
  memory.append(meta);
  return memory;
}

function seamCard() {
  const box = el("div", "card lead request");
  box.append(el("p", "q", "Push to your store now?"), el("p", "hint", pushOffer || ""));
  const actions = el("div", "actions");
  const leave = button("Leave it for now", "secondary", () => { pushOffer = false; render(); });
  const push = button(pushing ? "Pushing…" : "Push now", "primary", pushNow);
  leave.disabled = pushing;
  push.disabled = pushing;
  actions.append(leave, push);
  box.append(actions);
  return box;
}

async function pushNow() {
  pushing = true;
  render();
  const offer = pushOffer;
  if (await act(window.lore.push)) {
    const live = snapshot ? `${snapshot.publications.counts.active} ${snapshot.publications.counts.active === 1 ? "publication" : "publications"}` : "publications";
    pushedNote = `Pushed · ${live} sent to your node`;
  } else {
    pushOffer = offer;
  }
  pushing = false;
  render();
}

/** Approved publications a buyer cannot see yet. @param {Snapshot} s */
function unpushed(s) {
  return s.node.url ? s.publications.items.filter((item) => item.state === "approved" && item.live === false) : [];
}

/** @param {Snapshot} s */
function pushReceipt(s) {
  const box = el("div", "card pad lead");
  box.append(el("span", "dot ok"));
  const text = el("span", "", `${pushedNote} `);
  if (s.node.url) {
    const link = el("a", "", "Open your store ↗");
    link.href = s.node.url.replace(/\/mcp$/, "");
    link.target = "_blank";
    link.rel = "noreferrer";
    text.append(link);
  }
  box.append(text);
  return box;
}

/** @param {PublicationCandidate} original @param {boolean} approve @param {PublicationCandidate} [candidate] */
async function decide(original, approve, candidate = original) {
  if ((await act(() => window.lore.decide({ original, candidate, approve }))) && approve) approvedThisPass = true;
  if (candidates.length || !approvedThisPass) return;
  approvedThisPass = false;
  pushOffer = snapshot?.node.url ? "Approved publications reach buyers only after a push. Leaving it is fine; the next push carries it." : false;
  if (!pushOffer) tell("Approved. It goes on sale the moment you open a store.");
  render();
}

/** @param {() => Promise<void>} action */
async function act(action) {
  pushOffer = false;
  pushedNote = false;
  let done = true;
  try {
    await action();
  } catch (error) {
    done = false;
    tell(reason(error, "Lore could not do that."), true);
  }
  await load();
  return done;
}

/** @param {string} text @param {AgentTask} [from] */
async function send(text, from) {
  const files = attachments.length ? `\n\nFiles to read:\n${attachments.map((path) => `- ${path}`).join("\n")}` : "";
  attachments = [];
  renderAttachments();
  say(text, true);
  try {
    await window.lore.prompt({ text: text + files, task, from });
    await load();
  } catch (error) {
    say(reason(error, "Something went wrong."));
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
    welcomeNote.textContent = reason(error, "Sign-in didn't complete.");
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

/** @param {AgentEvent} event */
function onEvent(event) {
  if (event.type === "working") {
    busy = event.active ? event.task : null;
    liveText = busy ? liveText || { setup: "Thinking…", publish: "Drafting…", capture: "Reading this…", deploy: "Setting up your store…" }[busy] : "";
    syncComposer();
    renderLog();
  }
  else if (event.type === "live") { if (event.task === task) live(event.text); }
  else if (event.type === "changed") void load();
  else if (event.type === "message") { if (event.task === task) say(event.text); }
  else if (event.type === "saved") { if (event.task === task) { lines.push({ text: "", owner: false, saved: event.memories }); renderLog(); } }
  else if (event.type === "stopped") { say(event.text, false, true); input.focus({ preventScroll: true }); }
  else if (event.type === "task") {
    if (detailTask === event.task.kind) detailRecord = event.task;
    taskItems = event.task.state === "done"
      ? taskItems.filter((item) => item.kind !== event.task.kind)
      : [event.task, ...taskItems.filter((item) => item.kind !== event.task.kind)].slice(0, 3);
    render();
  }
  else if (event.type === "progress") {
    if (event.done) {
      welcome.classList.remove("provisioning");
      welcomeNote.textContent = "";
      boot();
    } else {
      welcome.classList.add("provisioning");
      welcomeNote.textContent = event.error ?? event.text ?? "";
      welcomeRetry.hidden = !event.error;
      if (!auth) { auth = { credentials: [] }; enter(); }
    }
  } else if (event.type === "dismiss") {
    if (request?.id === event.id) { clearRequest(); renderLog(); }
  } else if (event.type === "auth") {
    const detail = event.event;
    welcomeNote.textContent = event.message || (detail?.type === "device_code" ? `Open ${detail.verificationUri} and enter ${detail.userCode}.` : detail && "message" in detail ? detail.message : "Continue signing in.");
  } else if (event.task && event.task !== detailTask) {
    // A card belongs in its own thread, never under whichever heading happens to be open.
    void openTask(event.task).then(() => renderRequest(event));
  } else renderRequest(event);
}

window.lore.onAgentEvent(onEvent);

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  const card = shownRequest();
  if (card?.current) {
    if (!text) return;
    input.value = "";
    input.style.height = "";
    await respond(card.id, { entries: card.current(), note: text }, text);
    return;
  }
  if (!text && !attachments.length) return;
  if (!detailTask) {
    // The agent resumes an unfinished capture session, so the owner should see that conversation, not an empty thread.
    const unfinished = taskItems.find((item) => item.kind === "capture");
    if (unfinished) await openTask("capture", unfinished);
    else {
      task = "capture";
      detailTask = "capture";
      detailRecord = null;
      lines.splice(0);
      render();
    }
  }
  input.value = "";
  input.style.height = "";
  await send(text || "Please read the attached files.");
});
input.addEventListener("input", () => fit(input));
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
});
const DICTATE_HINT = "You can also press the dictation key on your keyboard (or fn twice) and speak into the box.";
const RATE = 16000;
const MAX_DICTATION_MS = 10 * 60_000;
const dictate = /** @type {HTMLButtonElement} */ ($("#dictate"));
/** @type {{ stop(): Promise<Float32Array[]> } | null} */
let recorder = null;
let dictationLimit = 0;
let spoken = "";
const dictationBox = $("#dictation");
const dictationText = $("#dictation-text");
/** @param {"listening" | "transcribing" | null} mode */
function dictationMode(mode) {
  if (mode) composer.dataset.mode = mode;
  else delete composer.dataset.mode;
  dictationBox.hidden = !mode;
  dictationText.textContent = mode === "listening" ? "Listening…" : mode === "transcribing" ? "Transcribing…" : "";
  dictate.disabled = mode === "transcribing";
  dictate.title = mode === "listening" ? "Stop dictating" : "Dictate";
  dictate.setAttribute("aria-label", dictate.title);
  dictate.setAttribute("aria-pressed", String(mode === "listening"));
}
async function record() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: RATE });
  const source = context.createMediaStreamSource(stream);
  const tap = context.createScriptProcessor(4096, 1, 1);
  /** @type {Float32Array[]} */
  const chunks = [];
  tap.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(tap);
  tap.connect(context.destination);
  return {
    stop: async () => {
      tap.disconnect();
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
      await context.close();
      return chunks;
    }
  };
}
/** 16-bit mono PCM WAV. @param {Float32Array[]} chunks */
function wav(chunks) {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const ascii = (/** @type {number} */ offset, /** @type {string} */ text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) { view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true); offset += 2; }
  return buffer;
}
dictate.addEventListener("click", async () => {
  if (recorder) {
    const active = recorder;
    recorder = null;
    clearTimeout(dictationLimit);
    dictationMode("transcribing");
    let text = "";
    try {
      text = await window.lore.transcribe(wav(await active.stop()));
    } catch (error) {
      tell(`Lore couldn't transcribe that: ${/** @type {Error} */ (error).message}. ${DICTATE_HINT}`, true);
    }
    dictationMode(null);
    input.value = spoken + text;
    fit(input);
    input.focus({ preventScroll: true });
    return;
  }
  spoken = input.value.trim() ? `${input.value.trimEnd()} ` : "";
  dictate.disabled = true;
  try {
    if (!(await window.lore.microphone())) {
      tell(`Lore needs the microphone: System Settings → Privacy & Security → Microphone. ${DICTATE_HINT}`, true);
      return;
    }
    recorder = await record();
    dictationMode("listening");
    dictationLimit = window.setTimeout(() => dictate.click(), MAX_DICTATION_MS);
  } catch (error) {
    tell(`Lore couldn't start the microphone: ${/** @type {Error} */ (error).message}. ${DICTATE_HINT}`, true);
  } finally {
    if (!recorder) dictate.disabled = false;
  }
});
const GUARDED = /(^|\/)\.[^/]*$|\/\.(ssh|aws|gnupg)\/|\.(pem|key|p12|pfx|keychain(-db)?)$|id_(rsa|ed25519|ecdsa)/;
/** @param {string[]} paths */
function attach(paths) {
  for (const path of paths) {
    if (attachments.includes(path)) continue;
    if (GUARDED.test(path)) {
      tell(`${path.split("/").pop()} looks like a credential or hidden file, so Lore won't read it. Rename or copy it first if you really mean to.`, true);
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

taskBack.addEventListener("click", closeTask);
taskRestart.addEventListener("click", () => { if (detailTask) void startOver(detailTask); });
for (const nav of navButtons) nav.addEventListener("click", () => {
  const next = /** @type {View} */ (nav.dataset.view);
  if (next === "today" && detailTask) closeTask();
  else show(next);
});
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
welcomeRetry.addEventListener("click", () => {
  welcomeRetry.hidden = true;
  welcomeNote.textContent = "Setting Lore up on this Mac…";
  void window.lore.retrySetup();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); search.focus(); search.select(); }
  if (event.key === "Escape" && document.querySelector(".sheet")) { event.preventDefault(); closeSheet(); }
  if (event.key === "Escape" && accountMenuOpen) { accountMenuOpen = false; renderAccount(); }
});
document.addEventListener("click", (event) => {
  if (accountMenuOpen && !account.contains(/** @type {Node} */ (event.target))) { accountMenuOpen = false; renderAccount(); }
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

Object.assign(window, { __lore: { show, openTask, preview: renderRequest, event: onEvent, signIn: () => { previewSignIn = true; auth = { credentials: [{ providerId: "anthropic", type: "oauth" }] }; enter(); } } });

function boot() {
  if (previewSignIn) return;
  window.lore.agentStatus().then((result) => { auth = result; enter(); }).catch(() => { auth = { credentials: [] }; enter(); });
}

boot();
