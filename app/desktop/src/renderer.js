/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const welcome = $("#welcome");
const appShell = $("#app");
const welcomeNote = $("#welcome-note");
const welcomeBack = $("#welcome-back");
const welcomeRetry = /** @type {HTMLButtonElement} */ ($("#welcome-retry"));
const redirectForm = /** @type {HTMLFormElement} */ ($("#redirect-form"));
const keyForm = /** @type {HTMLFormElement} */ ($("#key-form"));
const eyebrow = $("#eyebrow");
const title = $("#title");
const status = $("#status");
const content = $("#content");
const account = $("#account");
const taskBack = /** @type {HTMLButtonElement} */ ($("#task-back"));
const taskRestart = /** @type {HTMLButtonElement} */ ($("#task-restart"));
const addMemoryBtn = /** @type {HTMLButtonElement} */ ($("#add-memory"));
const sellWritingBtn = /** @type {HTMLButtonElement} */ ($("#sell-writing"));
const skipBtn = /** @type {HTMLButtonElement} */ ($("#first-run-skip"));
const feedbackBtn = /** @type {HTMLButtonElement} */ ($("#feedback-open"));
const accountMenu = $("#account-menu");
const accountLine = $("#account-line");
const signOutBtn = /** @type {HTMLButtonElement} */ ($("#sign-out"));
const updateBtn = /** @type {HTMLButtonElement} */ ($("#update"));
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
const blueprintSlot = $("#blueprint");
const search = /** @type {HTMLButtonElement} */ ($("#search"));
const palette = /** @type {HTMLDialogElement} */ ($("#palette"));
const paletteInput = /** @type {HTMLInputElement} */ ($("#palette-input"));
const paletteList = $("#palette-list");
const paletteEnter = $("#palette-enter");
const mainEl = $("#main");
const header = /** @type {HTMLElement} */ (mainEl.querySelector("header"));
const navButtons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav button")]);

/** @typedef {"today" | "inventory" | "connectors" | "automations" | "faq" | "settings"} View */
/** @typedef {"all" | "private" | "sale" | "down"} Shelf */
/** @type {Snapshot | null} */
let snapshot = null;
/** The apps Lore can connect, read once from the CLI's catalog. @type {SourceApp[]} */
let apps = [];
/** What the owner's personal agents have saved, as their store counts it; null until Connectors asks. @type {AgentEntry[] | null} */
let agents = null;
/** Connecting an agent put the store online first; once it is, the sheet picks up where it left off. */
let agentAfterStore = false;
/** Whatever waits on an agent's save (its setup sheet, the first-run chat), told whatever Lore brings in from the
 * owner's agents. @type {Set<(reads: SourceRead[]) => void>} */
const agentWaiting = new Set();
/** What Lore does on its own, as the CLI lists it. @type {Routine[]} */
let routines = [];
/** The routines the owner started that are still going. @type {Set<string>} */
const running = new Set();
/** @type {AgentStatus | null} */
let auth = null;
/** @type {View} */
let view = "today";
/** Which of Inventory's tabs is open. @type {Shelf} */
let shelf = "all";
/** Inventory shows only what this agent or app brought in, until the owner removes its chip (APP-212). @type {{id: string, label: string} | null} */
let inventoryFrom = null;
/** @type {AgentTask} */
let task = "capture";
/** @type {TaskRecord[]} */
let taskItems = [];
/** What Lore read from connected apps, newest first, until the owner clears it. @type {ReadyRun[]} */
let readyRuns = [];
/** The evening check-in waiting for the owner; null on every day Lore found nothing worth asking. @type {CheckIn | null} */
let checkIn = null;
/** How many loads have started, bumped too by what the owner dismisses here; only the newest load's answer is shown,
 * so one that started before a "Not today" never brings the card back. */
let loads = 0;
/** @type {AgentTask | null} */
let detailTask = null;
/** @type {TaskRecord | null} */
let detailRecord = null;
/** @type {string[]} */
let attachments = [];
let liveText = "";
/** What Lore says it is doing beside the thinking bubble, e.g. "Reading…". */
let liveStatus = "";
let previewSignIn = false;
/** @type {Line[]} */
const lines = [];
/** @type {PublicationCandidate[]} */
let candidates = [];
/** @type {ExtrasCandidate[]} */
let extraDrafts = [];
let approvedThisPass = false;
/** Where the store stands on the public marketplace, as last read from the relay; null until Settings asks. @type {Listing | null} */
let listing = null;
/** The node the cached listing describes, so a redeploy to a new address asks again. */
let listingFor = "";
/** @type {string | false} */
let pushOffer = false;
let pushing = false;
/** Cards are being switched on by themselves, so a re-render doesn't switch them twice. */
let switchingCards = false;
/** @type {string | false} */
let pushedNote = false;
/** The node's ledger, read each time For Sale opens: rows, the reason it could not be read, or null while it loads. @type {Sale[] | Error | null} */
let sales = null;
/** Page views per piece, by public id; empty until read. @type {Record<string, number>} */
let views = {};
let salesAsked = false;
/** This copy's version and whether a newer one is on its way, from the main process. @type {AppUpdate | null} */
let appUpdate = null;
/** The task whose turn is open, while one is. @type {AgentTask | null} */
let busy = null;
/** The card awaiting the owner. A memory card also carries `current`, its entries as edited, so the composer can send a spoken or typed correction with them; `pinned` cards stay in view as the thread re-renders. @type {{id: string, task: AgentTask | null, box: HTMLElement, pinned: boolean, current?: () => ProposedMemory[]} | null} */
let request = null;
/**
 * The one blueprint panel node for the current setup thread: a read-only
 * ghost while propose_blueprint's fields are still streaming in, then the
 * same node reparented into #request as the confirm form once it settles
 * (APP-022 — one component, two modes). Null when no scan is in progress.
 * @type {HTMLFormElement | null}
 */
let blueprintGhost = null;
/** The ghost panel's fields as they arrive, merged in as each propose_blueprint delta parses further. @type {Partial<BlueprintFields> & { evidence?: string }} */
let blueprintDraft = {};
/** The ghost panel's per-field value nodes, built once and patched in place thereafter — a field's settle transition plays exactly once, whichever DOM node first carries a value. @type {Record<string, HTMLElement> | null} */
let blueprintFieldValues = null;

/** Drop the ghost panel and its draft — a new setup thread starts clean. */
function resetBlueprintGhost() {
  blueprintGhost = null;
  blueprintDraft = {};
  blueprintFieldValues = null;
  blueprintSlot.replaceChildren();
}

const RING = `<svg viewBox="0 0 26 26" fill="none"><rect x="4.5" y="5" width="17" height="16" rx="3.2" fill="currentColor"></rect><path d="M3 11.2L4.5 10.6C8 9.2 10.5 12.2 13 10.9S18.5 9.6 21.5 11.2L23 12" stroke="var(--accent)" stroke-width="1.7"></path><path d="M3 16.9L4.5 16.3C8 15 10.5 17.8 13 16.6S18.5 15 21.5 16.8L23 17.7" stroke="var(--accent)" stroke-width="1.7"></path></svg>`;
const RENAME_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V4h16v3M9 20h6M12 4v16"></path></svg>`;
const EDIT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"></path></svg>`;
const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"></rect><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"></path></svg>`;
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>`;
const LOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;
const INFO_ICON = `<svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path></svg>`;
const ALERT_ICON = `<svg class="notice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path></svg>`;
const SALE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12l-8 8-9-9V3h8z"></path><circle cx="7.5" cy="7.5" r="1.5"></circle></svg>`;
/** @type {Record<string, [name: string, icon: string]>} */
const PROVIDERS = {
  anthropic: ["Claude", "assets/claude.svg"],
  "openai-codex": ["ChatGPT", "assets/openai.svg"],
  openai: ["OpenAI", "assets/openai.svg"]
};
const NETWORKS = { "eip155:8453": "Base", "eip155:84532": "Base Sepolia, test network" };
const TEST_NETWORK = "eip155:84532";
const EXPLORERS = { "eip155:8453": "https://basescan.org", "eip155:84532": "https://sepolia.basescan.org" };
const REAL_MONEY = "I'm ready to switch my store to real money.";
const SETUP_INTENT = "Let's set up my Lore.";
const STORE_INTENT = "Help me open my store.";
const AGENT_STORE_INTENT = "Put my store online so my personal agents can save to it. Nothing goes on sale until I choose to sell it.";
const REDEPLOY_PRICE = "I changed my publication price. Redeploy my store so buyers pay the new amount.";
const STORE_FIX = "My store isn't responding. Find out why and bring it back online.";
// Six decimals, not the default two: a price can run below a cent, and rounding
// $0.000001 up to $0.01 would misstate what a buyer pays. Six is the CLI's floor.
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const TASK_TITLES = { capture: "Capture a memory", setup: "Set up your Lore", publish: "Publish from your Lore", deploy: "Open your store", synthesize: "Read what came in", checkin: "Look over today", evening: "Evening check-in" };
/** Stands in for the composer while a card in another thread holds the turn; its button opens that thread. @type {AgentTask | null} */
let waitingTask = null;
const waiting = el("div", "card pad lead composer-wait");
const waitingText = el("span");
waiting.append(el("span", "dot"), waitingText, button("Open", "secondary", () => { if (waitingTask) void openTask(waitingTask); }));
waiting.hidden = true;
composer.insertAdjacentElement("afterend", waiting);
/** Lore's own work between the owner's turns: never a thread on Today. @type {ReadonlySet<AgentTask>} */
const QUIET_TASKS = new Set(["synthesize", "checkin"]);
const THINKING = { setup: "Thinking…", publish: "Drafting…", capture: "Reading this…", deploy: "Setting up your store…", synthesize: "Reading…", checkin: "Reading…", evening: "Reading this…" };
const TASK_STATES = { needs_you: "Needs you", working: "Working", stopped: "Waiting for you", done: "Done" };

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
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  // Lore's own files changed under this open copy (an update or rebuild); only a relaunch loads a matching set.
  return /does not provide an export named|Cannot find module|ERR_MODULE_NOT_FOUND/.test(message) ? "Lore was updated while it was open. Quit Lore and open it again to continue." : message;
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

/** Who said a chat line, for a screen reader: the page shows it by where the line sits. @param {boolean} owner */
function speaker(owner) {
  return el("span", "sr-only", owner ? "You: " : "Lore: ");
}

/** APP-218: a chat's lines come in once each, a beat apart, by their data-say; a line already on screen never comes in
 * again, and more than a few at once is history coming back, shown at once. */
class Entrance {
  /** @type {Set<string>} */
  said = new Set();

  /** @param {HTMLElement[]} shown */
  play(shown) {
    const fresh = shown.filter((line) => !this.said.has(line.dataset.say ?? ""));
    for (const [beat, line] of fresh.entries()) {
      this.said.add(line.dataset.say ?? "");
      if (fresh.length > 3) continue;
      line.classList.add("enter");
      line.style.animationDelay = `${beat * 90}ms`;
    }
  }
}

/** @param {string} label @param {"primary" | "secondary" | "quiet"} kind @param {() => void} onClick @param {string} [icon] */
function button(label, kind, onClick, icon) {
  const node = el("button", `btn ${kind} sm`, label);
  node.type = "button";
  if (icon) node.insertAdjacentHTML("afterbegin", icon);
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
  await send(`Help me publish something from my Lore, starting from "${memory.title}".`, from, memory.id);
}

/** @param {number | string} id @param {string} title @param {string} detail @param {boolean} [sell] Whether it offers Draft for sale. */
function memoryRow(id, title, detail, sell = true) {
  const node = el("div", "row");
  const open = el("button", "task-link");
  open.type = "button";
  const text = el("div", "t");
  text.append(el("b", "", title), el("span", "", detail));
  open.append(text);
  open.addEventListener("click", () => openMemory(Number(id)));
  peekable(open, Number(id));
  node.append(open, ...(sell ? [button("Draft for sale", "quiet", () => void publishMemory({ id: Number(id), title }))] : []));
  return node;
}

/** An empty section that names its next step and carries the control that takes it. @param {string} text @param {HTMLElement} action */
function emptyState(text, action) {
  const node = el("div", "card pad empty act");
  node.append(el("span", "", text), action);
  return node;
}

/** A button that reads as a link inside a sentence. @param {string} label @param {() => void} onClick */
function inline(label, onClick) {
  const node = el("button", "inline", label);
  node.type = "button";
  node.addEventListener("click", onClick);
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
  hidePeek();
  /** @type {Memory} */
  let memory;
  try {
    memory = await window.lore.memory(id);
  } catch (error) {
    tell(reason(error, "Lore could not open that."), true);
    return;
  }
  closeSheet();
  // A native modal: focus stays inside, Escape closes it, and focus returns to what opened it.
  const sheet = el("dialog", "sheet");
  sheet.setAttribute("aria-label", memory.title);
  const panel = el("div", "card sheet-panel");
  const head = el("div", "sheet-head");
  const text = el("div", "t");
  const titleLabel = el("b", "", memory.title);
  text.append(titleLabel, provenanceLine(memory));
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", closeSheet);
  const actions = el("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  function showActions() {
    actions.replaceChildren(button("Rename", "quiet", startRename, RENAME_ICON), button("Edit", "quiet", startEdit, EDIT_ICON), button("Draft for sale", "quiet", () => void publishMemory(memory), SALE_ICON));
  }
  /** @type {HTMLElement} */
  let body = renderMemoryBody(memory.content);
  function startRename() {
    const input = el("input", "draft-title");
    input.type = "text";
    input.value = memory.title;
    input.setAttribute("aria-label", "Memory title");
    titleLabel.replaceWith(input);
    input.focus();
    input.select();
    actions.replaceChildren(button("Cancel", "secondary", cancelRename), button("Save", "primary", () => void saveRename()));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); void saveRename(); }
      else if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
    });
    function cancelRename() {
      input.replaceWith(titleLabel);
      showActions();
    }
    async function saveRename() {
      const title = input.value.trim();
      if (!title || title === memory.title) { cancelRename(); return; }
      try {
        memory = await window.lore.renameMemory(memory.id, title);
      } catch (error) {
        say(reason(error, "Lore could not rename that."));
        return;
      }
      titleLabel.textContent = memory.title;
      sheet.setAttribute("aria-label", memory.title);
      cancelRename();
      void load();
    }
  }
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
  // The panel fills the dialog, so a click that lands on the dialog itself came from the backdrop.
  sheet.addEventListener("click", (event) => { if (event.target === sheet) closeSheet(); });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
  close.focus();
}

function closeSheet() {
  /** @type {HTMLDialogElement | null} */ (document.querySelector("dialog.sheet[open]"))?.close();
}

function openFeedbackDialog() {
  const form = new FormSheet("Report feedback");
  form.form.classList.add("feedback-form");
  const titleField = form.title("Title");
  const descriptionField = form.prompt("Description", "What happened, and what did you expect?");
  const email = form.field("Email", { type: "email", placeholder: "Optional", ariaLabel: "Email (optional)" });
  form.group("", [email.row]);
  form.text("This becomes a public GitHub issue; anything you write here, and your email if you give one, is visible there.", "hint");
  form.button("Cancel", "secondary", () => form.close());
  // One report per Send, however the owner gets there: the sheet holds Send while one is out, and closes only
  // itself when it lands, never a sheet the owner opened since.
  form.open({
    primary: "Send",
    working: "Sending…",
    valid: () => Boolean(titleField.value.trim() && descriptionField.value.trim()),
    failed: "Lore could not send that.",
    submit: async () => {
      const receipt = await window.lore.reportFeedback({ title: titleField.value, email: email.control.value, description: descriptionField.value });
      tell(`Filed as ${receipt.url}`);
    }
  });
  titleField.focus();
}

/** @param {string} heading @param {HTMLElement} body @param {HTMLElement} [aside] */
function section(heading, body, aside) {
  const node = el("section", "section");
  if (heading || aside) {
    const head = el("div", "section-head");
    if (heading) head.append(el("h2", "", heading));
    if (aside) head.append(aside);
    node.append(head);
  }
  node.append(body);
  return node;
}

/** @param {HTMLElement[]} rows */
function card(rows) {
  const node = el("div", "card rows");
  node.append(...rows);
  return node;
}

/** Label and shorten a public payout address; leave ordinary answers intact. @param {string} text */
function brief(text) {
  return /^0x[0-9a-fA-F]{40}$/.test(text) ? `Payout: ${text.slice(0, 6)}…${text.slice(-4)}` : text;
}

/** @param {string} text @param {string} [className] */
function chip(text, className = "") {
  return el("span", `chip ${className}`, text);
}

/** @param {number | null} value */
function price(value) {
  return typeof value === "number" ? money.format(value) : "Not set";
}

/** A price with no trailing ".00": "$1", "$0.10", "$0.005". @param {number} value */
function dollars(value) {
  return price(value).replace(/\.00$/, "");
}

/** A state as a dot and a word, the way tiles say it. @param {string} text @param {"ok" | "attention" | "off"} [tone] */
function runState(text, tone = "off") {
  const node = el("span", "run-state");
  node.append(el("span", `dot ${tone === "attention" ? "" : tone}`.trim()), text);
  return node;
}

/** Under a day old: anything unfinished from before that is history, not something to act on. @param {string} iso */
const recent = (iso) => Date.now() - new Date(iso).getTime() < 86_400_000;

/** A date with no time of day is that calendar day here, not midnight in London. @param {string} iso */
function when(iso) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

const RUN_LABELS = { capture: "Capture", synthesis: "Synthesis", deploy: "Store deploy", push: "Store update" };
const RUN_STATES = { running: "Running", succeeded: "Done", failed: "Failed", incomplete: "Unfinished" };
/** Job kinds with an agent thread behind them, keyed to the task that thread belongs to. Synthesis and push are plain CLI runs with no owner-facing conversation, so a Recent-runs row for either stays non-interactive. @type {Partial<Record<JobItem["kind"], AgentTask>>} */
const JOB_TASK = { capture: "capture", deploy: "deploy" };

/** Recent owner runs, newest first, the same run again and again as one row. Absent when the installed CLI predates them.
 * @param {Snapshot} s */
function recentRuns(s) {
  if (!s.jobs) return null;
  const all = s.jobs.items;
  /** @type {Array<{item: JobItem, summary: string, times: number}>} */
  const runs = [];
  all.forEach((item, index) => {
    const summary = pushDetail(all, index) ?? item.summary;
    const last = runs.at(-1);
    if (last && last.item.kind === item.kind && last.item.status === item.status && last.item.title === item.title && last.summary === summary) last.times++;
    else runs.push({ item, summary, times: 1 });
  });
  if (!runs.length) return null;
  return section("Activity", card(runs.slice(0, 6).map(({ item, summary, times }) => {
    const detail = [summary, when(item.started_at), times > 1 ? `${times} times` : ""].filter(Boolean);
    const label = item.title?.trim() || RUN_LABELS[item.kind] || item.kind;
    const status = runState(RUN_STATES[item.status] ?? item.status, item.status === "running" ? "ok" : item.status === "failed" ? "attention" : "off");
    // A plain success has nothing more to show than this row already does; a run still going, or one that went wrong
    // today, opens its thread when there is one. Older than that, it is history.
    const task = item.status === "running" || (item.status !== "succeeded" && recent(item.finished_at ?? item.started_at)) ? JOB_TASK[item.kind] : undefined;
    if (!task) return row(label, detail.join(" · "), status, false);
    const node = el("div", "row");
    const open = el("button", "task-link");
    open.type = "button";
    const text = el("div", "t");
    text.append(el("b", "sans", label), el("span", "", detail.join(" · ")));
    open.append(text, status);
    // A job whose owning session never reached a terminal state (e.g. it was
    // conceded by reap_jobs, or the app restarted) has no entry in taskItems.
    // Without this, openTask falls back to null and the header fabricates
    // "Working · Starting" for a row the owner just saw chipped Failed/Unfinished.
    /** @type {TaskRecord} */
    const fallback = { version: 1, kind: task, title: label, state: item.status === "running" ? "working" : "stopped", phase: RUN_STATES[item.status] ?? item.status, updatedAt: item.finished_at ?? item.started_at };
    open.addEventListener("click", () => void openTask(task, undefined, fallback));
    node.append(open);
    return node;
  })));
}

/** What a finished push changed, from its own count against the push before it. The stored summary is a closed vocabulary, so this is read-time only.
 * @param {JobItem[]} items @param {number} index */
function pushDetail(items, index) {
  const item = items[index];
  if (item.kind !== "push" || item.status !== "succeeded" || typeof item.count !== "number") return null;
  const previous = items.slice(index + 1).find((other) => other.kind === "push" && other.status === "succeeded" && typeof other.count === "number");
  const delta = previous?.count == null ? 0 : item.count - previous.count;
  const change = delta > 0 ? `, ${delta} more than before` : delta < 0 ? `, ${-delta} fewer than before` : "";
  return `${item.count} publication${item.count === 1 ? "" : "s"} on your store${change}`;
}

/** Online for the owner's agents only is not live: nothing is for sale (XC-069). @param {Snapshot["node"]} node */
function nodeLabel(node) {
  const state = node.live.state;
  return state === "online" ? (node.selling === false ? "Online" : "Live") : state === "unreachable" ? "Offline" : "Not set up";
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

/** @param {string} label @param {string} href @param {string} [className] */
function outLink(label, href, className = "link-btn") {
  const link = el("a", className, label);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

/** @param {string | null} network */
function explorer(network) {
  return EXPLORERS[/** @type {keyof typeof EXPLORERS} */ (network ?? "")] ?? EXPLORERS["eip155:8453"];
}

/** @param {Snapshot["node"]["live"]} live @param {string} [className] */
function payoutLink(live, className) {
  return live.payout ? outLink("Payouts ↗", `${explorer(live.network)}/address/${live.payout}`, className) : null;
}

/** @param {Snapshot["node"]} node */
function storeAddress(node) {
  const url = /** @type {string} */ (node.url);
  const box = el("span", "address");
  box.append(el("span", "host", url.replace(/^https?:\/\//, "").replace(/\/mcp$/, "")));
  const console = workerConsole(url);
  if (console) box.append(outLink("Cloudflare ↗", console, "quiet-link"));
  const payouts = payoutLink(node.live, "quiet-link");
  if (payouts) box.append(payouts);
  return box;
}

/** Open for sale, not only online for the owner's agents (XC-069). @param {Snapshot | null} s */
function forSale(s) {
  return Boolean(s?.node.url) && s?.node.selling !== false;
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

/** A line icon from its strokes. @param {string} paths */
function lineIcon(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Each of Today's next steps by its mark. */
const STEP_ICONS = {
  connect: lineIcon(`<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>`),
  sell: lineIcon(`<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"></path>`),
  store: lineIcon(`<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"></path>`),
  publish: lineIcon(`<path d="M20 12l-8 8-9-9V3h8z"></path><circle cx="7.5" cy="7.5" r="1.5"></circle>`),
  update: lineIcon(`<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"></path><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path>`),
  memory: lineIcon(`<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z"></path><path d="M14 3.5V8h4M10 12.5h5M10 16h5"></path>`)
};

/** A small rounded tile holding a mark: a line icon, or an app's own logo. @param {string | HTMLElement} mark */
function markTile(mark) {
  // Lore's own mark fills its tile in Lore's colours, as in the sidebar, rather than a grey glyph on a grey tile.
  const node = el("span", mark === RING ? "routine-mark lore" : "routine-mark");
  if (typeof mark === "string") node.innerHTML = mark;
  else node.append(mark);
  return node;
}

/** "A", "A and B", or "A, B and 2 more". @param {string[]} names */
function named(names) {
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** The picture one contributor shows with: an agent's or app's own mark, a clock for a routine, a pen for the owner,
 * a page for a file they brought in, and Lore's own for what Lore wrote. @param {MemorySource} source */
function sourceMark(source) {
  if (source.kind === "agent") return agentMark(/** @type {AgentApp} */ (source.mark), source.label);
  // Only a mark Lore ships is drawn; anything else gets the same plain one.
  if (source.kind === "app") return Object.hasOwn(AGENT_MARKS, source.mark) ? brand(AGENT_MARKS[source.mark], source.label) : apps.some((app) => app.id === source.mark) ? brand(source.mark, source.label) : STEP_ICONS.connect;
  if (source.kind === "routine") return CLOCK_ICON;
  if (source.kind === "capture") return source.mark === "file" ? STEP_ICONS.memory : EDIT_ICON;
  return RING;
}

/** APP-213: where a memory came from, drawn the same wherever it shows: each contributor's mark, newest first and
 * overlapping, three at most then "+N", and the line that names them. Nobody on record means Lore wrote it.
 * @param {MemorySource[] | undefined} sources */
function provenance(sources) {
  const from = sources?.length ? sources : [{ kind: /** @type {const} */ ("lore"), id: "lore", label: "Lore", mark: "lore", at: null }];
  const marks = el("span", "mark-stack");
  for (const source of from.slice(0, 3)) marks.append(markTile(sourceMark(source)));
  if (from.length > 3) marks.append(el("span", "routine-mark more", `+${from.length - 3}`));
  const line = from[0].kind === "lore" ? "Written by Lore" : `From ${named(from.map((source) => source.label))}`;
  return { marks, line };
}

/** A memory's row that leads with where it came from. @param {{id: number, title: string, sources?: MemorySource[]}} memory
 * @param {string[]} rest What else the row says, after where it came from. @param {boolean} [sell] */
function sourcedRow(memory, rest, sell) {
  const { marks, line } = provenance(memory.sources);
  const node = memoryRow(memory.id, memory.title, [line, ...rest].filter(Boolean).join(" · "), sell);
  node.prepend(marks);
  return node;
}

/** The line under a memory's title in its sheet and its preview: its marks, where it came from, and its date.
 * @param {Memory} memory */
function provenanceLine(memory) {
  const { marks, line } = provenance(memory.sources);
  const node = el("span", "provenance");
  node.append(marks, [line, when(memory.updated_at)].filter(Boolean).join(" · "));
  return node;
}

/** The one thing to do next, by the first stage that applies: a store in trouble, changes not live yet, drafts to
 * approve (the drafts themselves are the step), memories with nothing to sell, then no agent or app at all. None while
 * the store is being opened, repaired or updated.
 * @param {Snapshot} s @returns {{ mark: keyof typeof STEP_ICONS, label: string, detail: string, action: string, run: () => void } | "drafts" | null} */
function nextStep(s) {
  if (pushOffer || pushing || underWay("deploy")) return null;
  if (s.node.url && s.node.live.state === "unreachable") return { mark: "store", label: "Your store isn't responding", detail: "Buyers and your agents can't reach it right now. Lore can find out why and bring it back.", action: "Fix it", run: resume("deploy", () => startDeploy(STORE_FIX)) };
  const waiting = unpushed(s);
  const stale = stalePrice(s);
  const changes = waiting.length + (stale === null ? 0 : 1);
  if (changes) {
    const detail = [pendingLabel(waiting), stale === null ? "" : `Your store still charges ${price(stale)}, not ${price(s.pricing.publication_usd)}`].filter(Boolean).join(" · ");
    return { mark: "update", label: `${plural(changes, "change")} ${changes === 1 ? "isn't" : "aren't"} live yet`, detail, action: "Update store", run: waiting.length ? pushNow : resume("deploy", () => startDeploy(REDEPLOY_PRICE)) };
  }
  const approved = s.publications.counts.active;
  if (approved && !forSale(s)) return { mark: "store", label: `${plural(approved, "approved piece")} ${approved === 1 ? "isn't" : "aren't"} on sale yet`, detail: "Open your store to sell it. Pick a price and where payments go.", action: "Open your store", run: resume("deploy", () => startDeploy()) };
  if (candidates.length || extraDrafts.length) return "drafts";
  const drafting = taskItems.some((item) => item.kind === "publish" && item.state !== "done");
  // An open publish thread is the step itself, under Unfinished.
  if (s.library.counts.private && !approved) return drafting ? null : { mark: "sell", label: "Turn what you know into something to sell", detail: "Lore drafts up to three pieces from your memories. You approve each one.", action: "Start", run: resume("publish", () => startPublish()) };
  if (!s.library.sources.some((source) => source.connector || source.enabled)) return { mark: "connect", label: "Connect the AI you talk to most", detail: "Grok Bot, ChatGPT or Claude saves what it learns about you. It stays private until you approve a piece.", action: "Connect", run: () => { show("connectors"); new AgentSetup().open(); } };
  return null;
}

/** Whether the agent is at work on a thread of this kind. @param {AgentTask} kind */
function underWay(kind) {
  return busy === kind || taskItems.some((item) => item.kind === kind && item.state === "working");
}

/** A step's action: back into its thread while that thread is at work, so a second click never sends a second prompt.
 * @param {AgentTask} kind @param {() => Promise<void>} start */
function resume(kind, start) {
  return () => void (underWay(kind) ? openTask(kind) : start());
}

/** Today's next step as one card, opened by a click anywhere on it. @param {Exclude<ReturnType<typeof nextStep>, "drafts" | null>} step */
function nextStepCard(step) {
  const node = row(step.label, step.detail, cell(button(step.action, "primary", step.run)), false);
  node.prepend(markTile(STEP_ICONS[step.mark]));
  node.classList.add("routine", "next-step");
  node.addEventListener("click", (event) => {
    if (!(event.target instanceof Element && event.target.closest("button"))) node.querySelector("button")?.click();
  });
  const list = el("div", "routines today-cards");
  list.append(node);
  return section("Next step", list);
}

/** Unfinished threads, without the store's once the store is open, or once a finished thread put it online for the
 * owner's agents, unless it is at work (a repair, a reprice): nothing is left to finish there. Quiet work is no thread,
 * a check-in waiting on its card is not one yet, and one left more than a day ago is history. */
function displayTasks() {
  const storeDone = (/** @type {TaskRecord} */ item) => item.state !== "working" && (forSale(snapshot) || (Boolean(snapshot?.node.url) && item.state === "done"));
  return taskItems.filter((item) => !QUIET_TASKS.has(item.kind) && !(item.kind === "deploy" && storeDone(item)) && !(item.kind === "evening" && checkIn) && (item.state === "working" || recent(item.updatedAt))).slice(0, 3);
}

/** The evening check-in leads Today: the questions Lore would like five minutes on, and a way to say not today. @param {CheckIn} asked */
function checkInCard(asked) {
  const answer = button("Answer", "primary", () => void openTask("evening"));
  const later = button("Not today", "quiet", () => {
    loads++;
    checkIn = null;
    render();
    void window.lore.dismissCheckIn();
  });
  const [first, ...rest] = asked.questions;
  return section("Check in", card([
    row(first.question, "Five minutes? Lore saves only what you approve.", cell(later, answer), false),
    ...rest.map((each) => row(each.question, `About ${each.title}`, cell(), false))
  ]));
}

/** A reading under way, as one quiet row. @param {TaskRecord} item */
function readingRow(item) {
  const reading = row(`${item.phase}…`, "Lore will tell you when your memories are ready.", runState("Working", "ok"), false);
  reading.querySelector("b")?.classList.add("shimmer");
  return card([reading]);
}

/** What Lore made of a connected app's newest items: each new memory, and a draft one press away for the ones worth selling. @param {ReadyRun[]} runs */
function memoriesReady(runs) {
  const memories = runs.flatMap((run) => run.memories.map((memory) => ({ ...memory, by: run.by })));
  const selling = memories.filter((memory) => memory.sell).length;
  const [latest] = runs;
  const heading = runs.every((run) => run.title === latest.title) ? latest.title : "Lore read what you brought in";
  const detail = [`${plural(memories.length, "new memory")}, only on this Mac`, selling ? `${selling} ${selling === 1 ? "looks" : "look"} worth selling` : ""].filter(Boolean).join(" · ");
  const clear = button("Clear", "quiet", () => void window.lore.clearMemories().then(() => { readyRuns = []; render(); }));
  /** What the library has on record for a memory, or, until the reading's own credit lands (it is recorded last), who the
   * reading was. @param {number} id @param {Contributor} [by] */
  const sources = (id, by) => {
    const kept = snapshot?.library.items.find((item) => item.id === id)?.sources;
    return by && (!kept || kept[0]?.kind === "lore") ? [{ ...by, at: null }] : kept;
  };
  const list = el("div", "routines today-cards");
  for (const memory of memories) {
    const node = sourcedRow({ id: memory.id, title: memory.title, sources: sources(memory.id, memory.by) }, [memory.sell ? `Worth selling · ${memory.why}` : memory.work ? "Work · stays private" : "Private"], memory.sell);
    node.classList.add("routine");
    list.append(node);
  }
  noticeReady();
  const aside = el("div", "list-aside");
  aside.append(el("span", "", `${heading} · ${detail}`));
  // One agent behind every memory here: one click to what it saved.
  const by = runs[0].by;
  if (by?.kind === "agent" && runs.every((run) => run.by?.id === by.id) && memories.every((memory) => sources(memory.id, memory.by)?.some((source) => source.id === by.id))) {
    aside.append(inline("See them →", () => seeFrom({ id: by.id, label: by.label })));
  }
  aside.append(clear);
  return section("New memories", list, aside);
}

/** The owner is looking at the new memories, so the dock stops counting them. */
function noticeReady() {
  if (view !== "today" || detailTask || !document.hasFocus() || readyRuns.every((run) => run.seen)) return;
  readyRuns = readyRuns.map((run) => ({ ...run, seen: true }));
  void window.lore.seenMemories();
}

function draftsPhase() {
  const count = candidates.length + extraDrafts.length;
  return `${count} ${count === 1 ? "draft" : "drafts"} to approve`;
}

/** Threads whose agent can stage a publication draft. */
const DRAFTING = new Set(["publish", "capture"]);

/** Drafts to approve, and the push after approving. @param {Snapshot} s */
function drafts(s) {
  /** @type {HTMLElement[]} */
  const parts = [];
  if (candidates.length || extraDrafts.length) parts.push(section("Approve what to sell", approvals(), el("span", "hint", "Buyers only ever get what you approve here.")));
  if (pushOffer || pushing) parts.push(seamCard());
  if (pushedNote) parts.push(pushReceipt(s));
  return parts;
}

/** What came in, and the one thing to do next. @param {Snapshot} s */
function renderToday(s) {
  if (firstRun.active && !detailTask) return firstRun.parts(s);
  /** @type {HTMLElement[]} */
  const parts = [];
  // A check-in leads Today, on the rare day there is one.
  if (detailTask) {
    // Drafts and the push after approving show in the threads that draft, as on Today.
    if (DRAFTING.has(detailTask)) parts.push(...drafts(s));
    if ((detailTask === "setup" || detailTask === "deploy") && detailRecord?.state === "done") parts.push(nextRung(s));
    return parts;
  }
  // A check-in leads Today, on the rare day there is one.
  if (checkIn) parts.push(checkInCard(checkIn));
  if (!s.library.counts.private && howItWorks.shown()) parts.push(howItWorks.line());
  const reading = taskItems.find((item) => item.kind === "synthesize" && item.state === "working");
  if (reading) parts.push(readingRow(reading));
  if (readyRuns.length) parts.push(memoriesReady(readyRuns));
  const step = nextStep(s);
  if (step === "drafts") parts.push(...drafts(s));
  else if (step) parts.push(nextStepCard(step));
  const shown = displayTasks();
  if (shown.length) {
    const list = el("div", "routines today-cards");
    for (const item of shown) {
      const row = el("div", "row routine");
      const open = el("button", "task-link");
      open.type = "button";
      const text = el("div", "t");
      text.append(el("b", "sans", item.title), el("span", "", item.phase));
      open.append(text, runState(TASK_STATES[item.state], item.state === "working" ? "ok" : item.state === "needs_you" ? "attention" : "off"));
      open.addEventListener("click", () => void openTask(item.kind, item));
      row.append(markTile(ROUTINE_ICONS.ask), open);
      list.append(row);
    }
    parts.push(section("Unfinished", list));
  }
  if (step !== "drafts") parts.push(...drafts(s));
  return parts;
}

/** Today's way into the FAQ for a new owner, until their first memory, their first paid sale, or until they close it. */
class HowItWorks {
  key = "lore.how-it-works.closed";

  shown() {
    const paid = Array.isArray(sales) && sales.some((sale) => sale.network !== "free");
    try {
      return !paid && !localStorage.getItem(this.key);
    } catch {
      return !paid;
    }
  }

  line() {
    const node = el("div", "how-it-works");
    const close = el("button", "dismiss", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.addEventListener("click", () => {
      try {
        localStorage.setItem(this.key, "1");
      } catch {}
      node.remove();
    });
    node.append(el("span", "", "New to Lore?"), button("How it works", "quiet", () => show("faq")), close);
    return node;
  }
}

const howItWorks = new HowItWorks();

/** Whether a read left the place it read readable. @param {SourceRead[]} reads @param {string} name */
function readable(reads, name) {
  const read = reads.find((each) => each.name === name);
  return Boolean(read && CONNECTION_STATES[read.state].ok);
}

/** How long Lore waits on where the first run stands before going on without it. */
const FIRST_RUN_READ_MS = 5000;

/** What a new owner can answer to "Which AI do you talk to most?": their personal agents, then the coding agents Lore
 * already knows how to read, then none. @type {Array<[AgentApp | "coding" | "none", string]>} */
const FIRST_CHOICES = [["grok", "Grok Bot"], ["muse", "Muse"], ["chatgpt", "ChatGPT"], ["claude", "Claude"], ["coding", "Claude Code or Codex"], ["none", "None of these"]];

/** APP-215: the first-run chat. Lore starts it itself right after a new owner signs in, speaks first, and asks one
 * thing at a time. First the apps it found on this Mac, one tap to connect them all, so something comes in before
 * anything is asked of the owner (APP-223); then which AI they talk to most, then (only for an agent online, and only
 * if the store isn't) to put the store online, then what to paste into that agent, waiting live for its first save.
 * Every step is the app's own, not the model's; where it stands is kept so a relaunch resumes it, and Skip for now
 * always lands on Today. */
class FirstRunChat {
  /** Where it stands, as kept across launches; null before it ever started. @type {FirstRunState | null} */
  kept = null;
  /** On screen now, in place of Today. */
  active = false;
  /** @type {"ask" | "store" | "connect" | "saved" | "end"} */
  stage = "ask";
  /** Past the apps on this Mac: connected, set aside, or none found. */
  appsDone = false;
  /** The sources the apps step connected, to say what they brought in. @type {string[]} */
  brought = [];
  /** The agent the owner picked. @type {[AgentApp, string] | null} */
  picked = null;
  /** Its link, shown this launch only: the key is never shown again. @type {AgentKey | null} */
  handed = null;
  /** How many memories the first save brought. */
  saved = 0;
  /** The agent apps on this Mac (APP-216). @type {AgentApp[]} */
  installed = [];
  /** The places found on this Mac, each to connect, until the owner connects them. @type {Array<{label: string, mark: string, detail: string, on: boolean, connect: (run: number) => Promise<string | undefined>}> | null} */
  found = null;
  /** What the one tap connected. @type {string[]} */
  connected = [];
  /** What it could not connect, said plainly over the places left to try again. */
  unconnected = "";
  /** What went wrong at the current step, said under it. */
  problem = "";
  /** A step under way: its button waits. */
  working = false;
  /** A new link on its way: one at a time, so a revoked one never shows last. */
  rotating = false;
  stop = () => {};
  /** Moves on when the owner leaves or signs out, so a step still under way from before stops where it is. */
  #run = 0;
  /** Moves on with each ask for a link, and when the owner chooses another agent: only the latest ask is shown. */
  #asks = 0;
  /** Whether where it stands has been read this sign-in: until then nothing starts it. */
  #known = false;

  /** Whether a step begun in `run` still belongs on screen. @param {number} run */
  current(run) {
    return run === this.#run && this.active;
  }
  entrance = new Entrance();

  /** Read where it stands, before the first snapshot lands, so Today never flashes first. A read that doesn't answer
   * in a few seconds counts as none, so Lore never waits on it; its late answer is not taken. */
  async read() {
    const run = this.#run;
    const late = new Promise((done) => setTimeout(() => done(null), FIRST_RUN_READ_MS));
    const kept = await Promise.race([window.lore.firstRun().catch(() => null), late]);
    // A sign-out since, or a choice made meanwhile, is newer than what was read.
    if (run !== this.#run || this.#known) return;
    this.kept = kept;
    this.#known = true;
  }

  /** With the snapshot in: a new owner (nothing kept, nothing connected) starts it; one already started resumes.
   * @param {Snapshot} s */
  consider(s) {
    if (this.active || appShell.hidden || !this.#known) return;
    const fresh = !s.library.counts.private && !s.publications.counts.active && !s.library.sources.some((source) => source.enabled || source.connector);
    if (!this.kept && fresh) void this.keep({ state: "started" });
    if (this.kept?.state !== "started") return;
    this.active = true;
    void window.lore.agentApps().then((installed) => { this.installed = installed; this.redraw(); }).catch(() => undefined);
    const waiting = this.kept.source && s.library.sources.find((source) => source.name === this.kept?.source);
    if (waiting) this.resume(waiting);
    else void this.look();
  }

  /** @param {FirstRunState} next */
  async keep(next) {
    this.kept = next;
    await window.lore.setFirstRun(next).catch(() => undefined);
  }

  redraw() {
    if (this.active && view === "today" && !detailTask) render();
  }

  /** Back after a relaunch, still waiting on the agent picked: its link was shown once, so a new one is a tap away.
   * @param {SourceEntry} source */
  async resume(source) {
    const app = /** @type {AgentApp} */ (source.app ?? "other");
    this.picked = [app, source.label];
    this.stage = "connect";
    this.appsDone = true;
    const run = this.#run;
    const entry = (await window.lore.agents().catch(() => [])).find((each) => each.source === source.name);
    if (!this.current(run)) return;
    if (entry?.saved) return this.heard(entry.saved);
    this.wait({ source: source.name, agent: { id: "", name: source.label, app, saved: entry?.saved ?? 0 } });
  }

  /** @param {AgentApp | "coding" | "none"} choice @param {string} label */
  async choose(choice, label) {
    if (this.working) return;
    // With nothing online to connect, the apps already brought in are the whole first run; with none, as before.
    if ((choice === "none" || choice === "coding") && this.brought.length) {
      this.picked = [/** @type {AgentApp} */ ("other"), label];
      this.stage = "end";
      void this.keep({ state: "done" });
      return this.redraw();
    }
    if (choice === "none") return this.leave("done", () => input.focus({ preventScroll: true }));
    if (choice === "coding") return this.leave("done", () => void startSetup());
    this.picked = [choice, label];
    this.problem = "";
    if (snapshot?.node.url) return this.connect();
    this.stage = "store";
    this.redraw();
  }

  /** The store online for the owner's agents, on the owner's tap: the deploy and, if it must, the Cloudflare sign-in. */
  async putOnline() {
    const run = this.#run;
    this.working = true;
    this.problem = "";
    this.redraw();
    try {
      await window.lore.storeOnline();
      // Asked of the store itself: a refresh already under way (an app's reading) can leave the window's copy stale.
      const online = Boolean((await window.lore.snapshot()).node.url);
      void load();
      // Skipped while it went online: the store stays online, and nothing goes on to connect.
      if (!this.current(run)) return;
      if (!online) throw new Error();
      this.working = false;
      await this.connect();
    } catch {
      if (!this.current(run)) return;
      this.working = false;
      this.problem = "Your store didn't go online. Try again in a minute.";
      this.redraw();
    }
  }

  async connect() {
    // One ask at a time; its error goes as it starts again.
    if (!this.picked || this.working) return;
    const run = this.#run;
    const ask = ++this.#asks;
    this.working = true;
    this.problem = "";
    this.redraw();
    try {
      const [app, name] = this.picked;
      const handed = await window.lore.connectAgent({ app, name });
      // Skipped while the link was on its way: the agent shows in Connectors, and the chat stays closed.
      if (!this.current(run) || ask !== this.#asks) return;
      this.handed = handed;
      this.stage = "connect";
      void this.keep({ state: "started", source: handed.source });
      this.wait(handed);
      void load();
      setTimeout(() => this.reveal(), 0);
    } catch (error) {
      if (!this.current(run) || ask !== this.#asks) return;
      this.problem = reason(error, `Lore couldn't connect ${this.picked[1]}. Try again.`);
    }
    this.working = false;
    this.redraw();
  }

  /** @param {Pick<AgentKey, "source" | "agent">} handed */
  wait(handed) {
    this.stop();
    this.stop = firstSave(handed, () => this.active, (saved) => this.heard(saved));
  }

  /** @param {number} saved */
  heard(saved) {
    this.saved = saved;
    this.stage = "saved";
    void this.keep({ state: "done", source: this.kept?.source });
    void load();
    this.redraw();
    this.reveal();
  }

  /** The newest of the chat in view. */
  reveal() {
    if (this.active && view === "today" && !detailTask) mainEl.scrollTo({ top: mainEl.scrollHeight, behavior: "smooth" });
  }

  /** Its link was lost: a new one, shown here, and the wait goes on with it. */
  async newLink() {
    const source = this.kept?.source;
    if (!source || this.rotating) return;
    const run = this.#run;
    this.rotating = true;
    this.redraw();
    try {
      const handed = await window.lore.agentKey(source);
      if (!this.current(run)) return;
      this.handed = handed;
      this.wait(handed);
    } catch (error) {
      if (!this.current(run)) return;
      this.problem = reason(error, "Lore couldn't reach your store. Try again.");
    }
    this.rotating = false;
    this.redraw();
  }

  /** The apps on this Mac Lore can read without asking anything: Obsidian vaults, and Claude Code's or Codex's memory.
   * Only what Lore already reads is left out: one it knows but couldn't read, even from before a relaunch, is offered
   * again. */
  async look() {
    if (this.found) return;
    const run = this.#run;
    const sources = snapshot?.library.sources ?? [];
    /** @param {SourceEntry | undefined} source */
    const reading = (source) => Boolean(source?.enabled && CONNECTION_STATES[source.state ?? "connected"].ok);
    const byPlace = new Map(sources.map((source) => [source.locator, source]));
    const vaults = (await window.lore.sourceChoices("obsidian").catch(() => /** @type {SourceChoice[]} */ ([]))).filter((vault) => !reading(byPlace.get(vault.locator)));
    if (!this.current(run)) return;
    const histories = sources.filter((source) => !source.connector && !reading(source));
    this.found = [
      ...vaults.map((vault) => {
        /** Once Lore knows the vault, even one it couldn't read, trying again reads it afresh. @type {string | null} */
        let known = byPlace.get(vault.locator)?.name ?? null;
        return { label: `Obsidian · ${vault.label}`, mark: "obsidian", detail: "Your notes", on: true, connect: async () => {
          if (known) {
            if (!readable(await window.lore.readSource(known), known)) throw new Error("Lore can't read it yet");
            return known;
          }
          const added = await window.lore.connectSource({ connector: "obsidian", locator: vault.locator });
          known = added.name;
          if (!CONNECTION_STATES[added.state ?? "connected"].ok) throw new Error("Lore can't read it yet");
          return known;
        } };
      }),
      // Connected once its first read has gone through and found it readable, so the chat never says Lore is reading
      // what it can't.
      // Claude Code's or Codex's memory is switched on first; a folder the owner added is only read again.
      ...histories.map((source) => ({ label: source.label, mark: AGENT_MARKS[source.name] ?? source.name, detail: source.owned ? "A folder you added" : "What it remembers about your work", on: true, connect: async (/** @type {number} */ run) => {
        if (!source.owned) await window.lore.switchSource(source.name, true);
        // Skipped while it was being switched on: it is not read after the owner left.
        if (!this.current(run)) return;
        if (!readable(await window.lore.readSource(source.name), source.name)) throw new Error("Lore can't read it yet");
        return source.name;
      } }))
    ];
    if (!this.found.length) this.appsDone = true;
    this.redraw();
  }

  /** One tap connects every place still ticked; any that fail stay, ticked, to try again. */
  async connectFound() {
    const chosen = (this.found ?? []).filter((place) => place.on);
    /** @param {{label: string}} place */
    const short = (place) => place.label.replace(/ · .*/, "");
    const run = this.#run;
    this.working = true;
    this.redraw();
    const failed = [];
    for (const place of chosen) {
      /** @type {string | undefined} */
      let name;
      let ok = true;
      try {
        name = await place.connect(run);
      } catch {
        ok = false;
      }
      if (!this.current(run)) return;
      if (ok) this.connected.push(short(place));
      else failed.push(place);
      if (name) this.brought.push(name);
    }
    this.found = failed;
    this.unconnected = failed.length ? `${named(failed.map(short))} didn't connect. Try again.` : "";
    if (!failed.length) this.appsDone = true;
    this.working = false;
    await load();
  }

  /** Done or skipped: Today, with its one next step. @param {"skipped" | "done"} state @param {() => void} [then] */
  leave(state, then) {
    this.stop();
    this.#run++;
    this.active = false;
    void this.keep({ state, ...(this.kept?.source ? { source: this.kept.source } : {}) });
    show("today");
    then?.();
  }

  /** Signed out: nothing on screen, and the next sign-in reads it again. */
  reset() {
    this.stop();
    this.#run++;
    this.#known = false;
    Object.assign(this, { kept: null, active: false, stage: "ask", appsDone: false, brought: [], picked: null, handed: null, found: null, connected: [], unconnected: "", problem: "", working: false, rotating: false, entrance: new Entrance() });
  }

  /** The chat as it stands, Lore first. @param {Snapshot} s */
  parts(s) {
    const chat = el("div", "log first-run");
    /** @param {...(string | HTMLElement)} said */
    const lore = (...said) => {
      const line = el("div", "line");
      line.dataset.say = said.map((part) => (typeof part === "string" ? part : part.className)).join(" ");
      line.append(speaker(false), ...said.map((part) => (typeof part === "string" ? el("p", "", part) : part)));
      chat.append(line);
    };
    /** @param {string} text */
    const owner = (text) => {
      const line = el("div", "line owner");
      line.dataset.say = `owner ${text}`;
      line.append(speaker(true), el("p", "", text));
      chat.append(line);
    };
    lore("Hi. I'm Lore. I keep what you've learned and help you sell the parts worth paying for.");
    // APP-223: first what's already on this Mac, so something comes in before anything is asked of the owner.
    if (!this.appsDone && !this.found) {
      lore(el("p", "hint", "Looking on this Mac…"));
      return this.shown(chat);
    }
    if (this.connected.length) lore(this.cameIn(s));
    if (!this.appsDone) {
      if (!this.connected.length && !this.unconnected) lore("First, I found these on this Mac. Connect them, and Lore reads them in a few seconds.");
      lore(this.foundCard());
      const more = el("p", "hint");
      more.append("Your ChatGPT or Claude history, and newsletters, connect from a file or an address in ", inline("Connectors", () => show("connectors")), ".");
      lore(more);
      return this.said(chat, lore);
    }
    lore("Which AI do you talk to most?");
    if (!this.picked) {
      lore(this.choices());
      return this.said(chat, lore);
    }
    const [app, who] = this.picked;
    owner(who);
    if (this.stage === "end") {
      lore(this.savedCard(s, who));
      lore("That's it. What it brought in stays private on this Mac. When you want to sell some of it, Today shows the next step.");
      const actions = el("div", "actions first-run-actions");
      actions.append(button("Go to Today", "primary", () => this.leave("done")));
      chat.append(actions);
      return this.said(chat, lore);
    }
    if (this.stage === "store") {
      lore(`Want ${who} to save here too? ${who} works online, so it needs a place online to save to. Lore sets one up for you, free on Cloudflare. Only your agents can save to it, and nothing goes on sale.`);
      const box = el("div", "card request");
      box.append(el("p", "hint", this.working ? "Setting it up. This takes a few minutes. If your browser opened, sign in to Cloudflare there." : "Takes a few minutes. Your browser opens so you can sign in to Cloudflare, or make a free account."));
      if (this.problem) box.append(el("p", "problem", this.problem));
      const actions = el("div", "actions");
      const go = button(this.working ? "Setting it up…" : "Set it up", "primary", () => void this.putOnline());
      go.disabled = this.working;
      actions.append(go);
      box.append(actions);
      lore(box);
      return this.shown(chat);
    }
    if (this.stage === "ask") {
      // Its link is on its way, or didn't come: try again, or pick another.
      if (!this.problem) {
        lore(el("p", "hint", `Getting ${who}'s link…`));
        return this.shown(chat);
      }
      const box = el("div", "card request");
      const actions = el("div", "actions");
      const other = button("Choose another", "secondary", () => {
        this.#asks++;
        Object.assign(this, { picked: null, problem: "", working: false });
        this.redraw();
      });
      const again = button("Try again", "primary", () => void this.connect());
      other.disabled = again.disabled = this.working;
      actions.append(other, again);
      box.append(el("p", "problem", this.problem), actions);
      lore(box);
      return this.shown(chat);
    }
    if (this.stage !== "saved") lore(this.handed ? `Here's how to connect ${who}. Lore shows it here when ${who} saves something.` : `${who}'s link was shown once. Get a new one here if you need it.`);
    if (this.stage !== "saved") lore(this.connectCard(app, who), waitLine(who, true));
    if (this.stage === "saved") {
      lore(this.savedCard(s, who));
      lore("That's it. What it saves stays private on this Mac. When you want to sell some of it, Today shows the next step.");
      const actions = el("div", "actions first-run-actions");
      actions.append(button("Go to Today", "primary", () => this.leave("done")));
      chat.append(actions);
    }
    return this.said(chat, lore);
  }

  /** The notices a new owner would otherwise get on Today, as one quiet line at the foot of the chat (APP-215).
   * @param {HTMLElement} chat @param {(...said: Array<string | HTMLElement>) => void} lore */
  said(chat, lore) {
    const said = notices.filter((item) => item.key);
    if (said.length) {
      lore(el("p", "hint", said.map((item) => item.text).join(" ")));
      for (const item of said) if (item.key) remember(item.key);
    }
    return this.shown(chat);
  }

  /** What the apps on this Mac brought in, once it's in. @param {Snapshot} s */
  cameIn(s) {
    const count = privateMemories(s).filter((item) => item.sources?.some((each) => this.brought.includes(each.id))).length;
    return count ? `Connected ${named(this.connected)}. ${plural(count, "memory")} came in.` : `Connected ${named(this.connected)}. Lore is reading them now…`;
  }

  /** @param {HTMLElement} chat */
  shown(chat) {
    this.entrance.play(/** @type {HTMLElement[]} */ ([...chat.children]));
    return [chat];
  }

  /** Each answer one tap; the agent apps on this Mac first, and the one found already picked. */
  choices() {
    const list = el("div", "choices first-choices");
    const ordered = [...FIRST_CHOICES].sort(([a], [b]) => Number(this.installed.includes(/** @type {AgentApp} */ (b))) - Number(this.installed.includes(/** @type {AgentApp} */ (a))));
    const only = this.installed.length === 1 ? this.installed[0] : null;
    for (const [choice, label] of ordered) {
      const option = el("button", choice === only ? "choice picked" : "choice");
      option.type = "button";
      const soon = choice === "muse";
      option.disabled = soon;
      const icon = choice === "coding" ? markTile(STEP_ICONS.memory) : choice === "none" ? markTile(EDIT_ICON) : agentMark(choice, label);
      option.append(icon, el("span", "", label));
      const hint = soon ? "Coming soon" : this.installed.includes(/** @type {AgentApp} */ (choice)) ? "On this Mac" : "";
      if (hint) option.append(el("small", "", hint));
      option.addEventListener("click", () => void this.choose(choice, label));
      list.append(option);
    }
    return list;
  }

  /** The connect card, one calm surface: the agent's own steps, the message to copy with its key masked, Open <agent>
   * when it's on this Mac, and the agent's note. After a relaunch the link is gone, so it offers a new one. @param {AgentApp} app @param {string} who */
  connectCard(app, who) {
    const box = el("div", "card first-connect");
    const guide = AGENT_GUIDES[app]?.first;
    if (this.handed) {
      if (guide?.brief) box.append(el("p", "first-steps", guide.brief));
      else if (guide) {
        const list = el("ol", "agent-steps");
        for (const step of guide.steps) list.append(el("li", "", step));
        box.append(list);
      }
      box.append(guide?.message ? privateLink(this.handed, guide.message, "Copy message") : privateLink(this.handed));
    }
    if (this.problem) box.append(el("p", "problem", this.problem));
    const foot = el("div", "first-connect-foot");
    if (!this.handed) {
      const again = button("Get a new link", "secondary", () => void this.newLink());
      again.disabled = this.rotating;
      foot.append(again);
    }
    if (this.installed.includes(app)) foot.append(button(`Open ${who}`, "secondary", () => void window.lore.openAgentApp(app).catch((error) => tell(reason(error, `Lore couldn't open ${who}.`)))));
    if (this.handed) {
      const hint = el("span", "quiet-hint");
      hint.innerHTML = LOCK_ICON;
      hint.append(el("span", "", "Private link, shown once"));
      foot.append(hint);
    }
    if (foot.childElementCount) box.append(foot);
    // What the agent's plan must allow, or how many connectors it takes, said quietly under the steps.
    const note = AGENT_GUIDES[app]?.note;
    if (this.handed && note) box.append(el("p", "hint", note));
    return box;
  }

  /** What the first save brought, titles and marks, one click from all of it. @param {Snapshot} s @param {string} who */
  savedCard(s, who) {
    // The agent's first save, and what the apps on this Mac brought in before it; with no agent, the apps' alone. Read
    // from the library, so it holds after a relaunch: everything a new owner has came from one or the other.
    const source = this.stage === "saved" ? this.kept?.source ?? "" : "";
    const kept = privateMemories(s);
    const mine = kept.filter((item) => source && item.sources?.some((each) => each.id === source));
    const others = kept.filter((item) => !mine.includes(item));
    const apps = named([...new Set(others.flatMap((item) => item.sources?.map((each) => each.label) ?? []))]) || "Your apps";
    const box = el("div", "card first-saved");
    const head = el("div", "row");
    head.append(el("b", "", source ? `${who} saved ${plural(this.saved, "memory")}` : `${apps} brought in ${plural(others.length, "memory")}`), inline("See them →", () => {
      this.leave("done");
      if (source && !others.length) seeFrom({ id: source, label: who });
      else show("memories");
    }));
    box.append(head);
    if (source && others.length) box.append(el("p", "hint first-saved-apps", `${apps} brought in ${plural(others.length, "memory")} too.`));
    const items = [...mine, ...others].slice(0, 5);
    for (const item of items) {
      const { marks } = provenance(item.sources);
      const node = row(item.title, when(item.updated_at), undefined, true);
      node.prepend(marks);
      box.append(node);
    }
    if (!items.length) box.append(el("p", "hint first-saved-wait", "Bringing them in…"));
    return box;
  }

  /** The places found, each ticked, and one tap for all of them. */
  foundCard() {
    const box = el("div", "card request");
    const list = el("div", "choices");
    for (const place of this.found ?? []) {
      const option = el("label", "choice");
      const tick = el("input");
      tick.type = "checkbox";
      tick.checked = place.on;
      tick.addEventListener("change", () => { place.on = tick.checked; this.redraw(); });
      const name = el("span", "first-place");
      name.append(brand(place.mark, place.label), el("span", "", place.label));
      option.append(tick, name, el("small", "", place.detail));
      list.append(option);
    }
    if (this.unconnected) box.append(el("p", "problem", this.unconnected));
    const actions = el("div", "actions");
    const count = (this.found ?? []).filter((place) => place.on).length;
    const go = button(this.working ? "Connecting…" : this.unconnected ? "Try again" : count > 1 ? "Connect these" : "Connect", "primary", () => void this.connectFound());
    go.disabled = this.working || !count;
    const later = button("Not now", "secondary", () => { this.appsDone = true; this.redraw(); });
    later.disabled = this.working;
    actions.append(later, go);
    box.append(list, actions);
    return box;
  }
}

const firstRun = new FirstRunChat();

/** @param {Snapshot} s */
function privateMemories(s) {
  return s.library.items.filter((item) => item.status === "private");
}

/** The publication price as it reads when nobody is editing it. @param {Snapshot} s */
function priceRow(s) {
  // Wrapped, not bare: `.prices` is a stretch-aligned column, so a bare button
  // would spread its hover background across the whole bar.
  const item = el("div", "price-row");
  const { publication_usd: piece, answer_usd: answer, answer_enabled: answers, free_copies: copies } = s.pricing;
  if (typeof piece === "number") {
    const open = el("button", "price-open");
    open.type = "button";
    open.title = "Change what a buyer pays per publication";
    open.append(`${dollars(piece)} `, el("span", "", ["a piece", copies ? freeCopies(copies) : ""].filter(Boolean).join(" · ")));
    open.addEventListener("click", openPriceSheet);
    item.append(open);
  } else if (s.node.url && s.node.live.state !== "unreachable") item.append(inline("Set a price", openPriceSheet));
  if (answers && typeof answer === "number") item.append(el("span", "", " · "), `${dollars(answer)} `, el("span", "", "an answer"));
  return item;
}

/** A dollar field with its prefix. @param {string} value @returns {[HTMLElement, HTMLInputElement]} */
function priceField(value) {
  const field = el("div", "price-field");
  const input = el("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.setAttribute("aria-label", "Price per publication in US dollars");
  input.value = value;
  input.placeholder = "0.01";
  field.append(el("span", "price-prefix", "$"), input);
  return [field, input];
}

const ABOVE_ZERO = "A price has to be a number above zero";

/** The amount typed, or null when the CLI would refuse it: zero is a conversation, not a text field. @param {string} raw */
function parsePrice(raw) {
  const amount = Number(raw.trim().replace(/^\$/, ""));
  return raw.trim() && Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** What the node charges when that differs from what the owner saved, after the push that carries the price; only a store from before pushed prices needs a redeploy. Read from the probe, so it survives a relaunch and says nothing about a node it cannot reach. @param {Snapshot} s */
function stalePrice(s) {
  const live = s.node.live.price_usd;
  return typeof live === "number" && typeof s.pricing.publication_usd === "number" && live !== s.pricing.publication_usd ? live : null;
}

/** The one editor for what a buyer pays: the price per piece and, from a CLI that has them, its free copies. */
function openPriceSheet() {
  const pricing = snapshot?.pricing;
  const form = new FormSheet("Price");
  const amount = form.field("Price per piece", { inputMode: "decimal", placeholder: "0.01", ariaLabel: "Price per publication in US dollars", value: typeof pricing?.publication_usd === "number" ? String(pricing.publication_usd) : "" }, "$");
  const copies = typeof pricing?.free_copies === "number" ? form.field("Free copies", { inputMode: "numeric", ariaLabel: "Free copies of each piece", value: String(pricing.free_copies) }) : null;
  form.group("", [amount.row, ...(copies ? [copies.row] : [])]);
  form.note("Buyers pay this for each piece, by card or through their AI agent.");
  form.button("Cancel", "secondary", () => form.close());
  form.open({
    primary: "Save",
    working: "Saving…",
    valid: () => Boolean(amount.control.value.trim() && (!copies || copies.control.value.trim())),
    submit: () => savePrice(amount.control.value, copies?.control.value)
  });
  amount.control.select();
}

const WHOLE_COPIES = "Free copies has to be a whole number, zero or more";

/** Save what the price sheet says; a refusal is thrown, so the sheet says it in place. @param {string} raw
 * @param {string} [rawCopies] Absent when the CLI predates free copies. */
async function savePrice(raw, rawCopies) {
  const amount = parsePrice(raw);
  if (amount === null) throw new Error(`${ABOVE_ZERO}. Free is a real choice, but you make it when you open your store.`);
  const copies = rawCopies === undefined ? null : Number(rawCopies.trim());
  if (copies !== null && (!rawCopies?.trim() || !Number.isInteger(copies) || copies < 0)) throw new Error(`${WHOLE_COPIES}.`);
  const before = snapshot?.pricing;
  const newCopies = copies !== null && copies !== before?.free_copies;
  pushOffer = false;
  pushedNote = false;
  try {
    if (amount !== before?.publication_usd) await window.lore.setPrice(amount);
    if (newCopies && copies !== null) await window.lore.setFreeCopies(copies);
  } finally {
    await load();
  }
  if (newCopies || amount !== before?.publication_usd) void goLive();
}

/** The store at a glance: whether it's live, its address, what a piece costs, and a pending update. @param {Snapshot} s */
function storeBar(s) {
  const live = s.node.live;
  const selling = forSale(s);
  const bar = el("div", "card store-bar");
  const lead = el("div", "lead");
  lead.append(el("span", `dot ${live.state === "online" && selling ? "ok" : live.state === "unreachable" ? "" : "off"}`));
  const text = el("div", "t");
  const state = !s.node.url ? "No store yet" : live.state === "unreachable" ? "Your store isn't responding" : !selling ? "Nothing for sale yet" : live.state === "online" ? (live.network === TEST_NETWORK ? "Live · Test mode" : "Live") : "No store yet";
  text.append(el("b", "sans", state));
  if (selling) {
    text.append(storeAddress(s.node));
  } else {
    const open = el("span");
    open.append(inline("Open your store", () => void startDeploy()), " when you're ready to sell.");
    text.append(open);
  }
  lead.append(text);
  const prices = el("div", "prices");
  prices.append(priceRow(s));
  const stale = stalePrice(s);
  if (stale !== null && !pushing) {
    const note = el("div", "stale-price");
    note.append(el("span", "", `Your store still charges ${price(stale)}.`));
    prices.append(note);
  }
  bar.append(lead, prices);
  // One Update store at a time: pieces waiting to go on or come off are pushed first; a new price is redeployed after.
  if (unpushed(s).length) {
    if (!pushOffer) {
      const push = button(pushing ? "Updating…" : "Update store", "primary", pushNow);
      push.disabled = pushing;
      bar.append(push);
    }
  } else if (stale !== null && !pushing) bar.append(button("Update store", "primary", () => void startDeploy(REDEPLOY_PRICE)));
  return bar;
}

/** One piece on sale: what it's about, how it's doing, and taking it down. @param {PublicationItem} item */
function saleItem(item) {
  const count = Array.isArray(sales) ? sales.filter((sale) => sale.item_id === item.public_id && sale.network !== "free").length : 0;
  const seen = views[item.public_id] ?? 0;
  const detail = [seen ? `${seen} ${seen === 1 ? "view" : "views"}` : "", count ? `${count} sold` : ""].filter(Boolean).join(" · ") || "No views yet";
  const badge = item.live === false ? chip("Not on your store yet") : el("span");
  const trailing = el("div", "v");
  const ask = button("Take down", "quiet", () => {
    trailing.replaceChildren(
      el("span", "hint", "No one can buy it after this. Anyone who already did keeps their copy."),
      button("Keep", "secondary", () => trailing.replaceChildren(badge, ask)),
      button("Take down", "primary", () => void act(() => window.lore.revoke(item.id), "Taken down. Your store stops selling it as soon as it updates."))
    );
    trailing.classList.add("asking");
  });
  trailing.append(badge, ask);
  return row(item.title, detail, trailing);
}

/** Inventory: everything Lore keeps, private or on sale, in groups by what it's about. @param {Snapshot} s */
function renderInventory(s) {
  const agentApp = (/** @type {string} */ label) => s.library.sources.find((source) => source.connector === "agent" && source.label === label)?.app;
  const from = inventoryFrom;
  const kept = privateMemories(s).filter((item) => !from || item.sources.some((source) => source.id === from.id));
  // A piece for sale says nothing of who brought its memories in, so filtering by one shows memories only.
  const onSale = from ? [] : s.publications.items.filter((item) => item.state === "approved");
  const down = from ? [] : s.publications.items.filter((item) => item.state === "revoked");
  unseen.forget();
  if (shelf === "down" && !down.length) shelf = "all";

  const tabs = el("div", "shelves");
  tabs.setAttribute("role", "tablist");
  // Approved pieces wait for the store to open for sale before anyone can buy them (XC-069).
  const saleLabel = forSale(s) ? "On sale" : "Ready to sell";
  const waitingNote = forSale(s) ? undefined : el("span", "hint", "Ready to sell once your store opens.");
  /** @type {[Shelf, string, number][]} */
  const shelves =[["all", "All", kept.length + onSale.length], ["private", "Private", kept.length], ["sale", saleLabel, onSale.length]];
  if (down.length) shelves.push(["down", "Taken down", down.length]);
  for (const [id, label, count] of shelves) {
    const tab = el("button", "shelf");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(shelf === id));
    tab.append(label, el("span", "shelf-count", String(count)));
    tab.addEventListener("click", () => { shelf = id; render(); });
    tabs.append(tab);
  }

  /** A group named for the agent or app its memories came from is headed by that one's own mark. @type {Map<string, MemorySource>} */
  const known = new Map();
  for (const item of kept) {
    for (const source of item.sources) if ((source.kind === "agent" || source.kind === "app") && source.label === item.project_label) known.set(source.label, source);
  }
  /** Rows under one heading, each group a card headed by what it's about. @param {Map<string, HTMLElement[]>} groups */
  const grouped = (groups) => [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => {
    const box = el("div", "card rows inv-group");
    const head = el("div", "inv-group-head");
    const app = agentApp(name);
    const source = known.get(name);
    const mark = source ? sourceMark(source) : app ? agentMark(app, name) : el("span", "logo initial", (name || "·")[0].toUpperCase());
    head.append(typeof mark === "string" ? markTile(mark) : mark, el("b", "", name || "Unsorted"), el("span", "shelf-count", String(rows.length)));
    box.append(head, ...rows);
    return box;
  });
  /** @template T @param {T[]} items @param {(item: T) => string} key @param {(item: T) => HTMLElement} make */
  const groupBy = (items, key, make) => {
    /** @type {Map<string, HTMLElement[]>} */
    const groups = new Map();
    for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), make(item)]);
    return grouped(groups);
  };
  const privateGroups = () => groupBy(kept, (item) => item.project_label, (item) => unseen.watch(sourcedRow(item, [when(item.updated_at)]), item.arrival));
  const saleGroups = () => groupBy(onSale, (item) => item.topic, saleItem);
  const downGroups = () => groupBy(down, (item) => item.topic, (item) => row(item.title, item.topic, item.live === true ? chip("Still on your store", "attention") : chip("Taken down")));
  const stack = (/** @type {HTMLElement[]} */ cards) => {
    const node = el("div", "inv-stack");
    node.append(...cards);
    return node;
  };

  /** @type {HTMLElement[]} */
  const parts = [storeBar(s)];
  if (pushOffer) parts.push(seamCard());
  if (pushedNote) parts.push(pushReceipt(s));
  const filters = el("div", "inv-filters");
  filters.append(tabs);
  if (from) {
    const only = el("span", "chip source-filter", from.label);
    const all = el("button", "dismiss", "×");
    all.type = "button";
    all.setAttribute("aria-label", `Show everything, not only ${from.label}`);
    all.addEventListener("click", () => {
      inventoryFrom = null;
      render();
    });
    only.append(all);
    filters.append(only);
  }
  parts.push(filters);
  const nothingKept = emptyState("Nothing kept yet. Say what you learned, or connect an agent, and Lore will keep it.", button("Add your first memory", "quiet", () => startCapture()));
  const nothingOnSale = emptyState("Nothing on sale yet.", button("See what's private", "quiet", () => { shelf = "private"; render(); }));
  if (shelf === "all") {
    if (!kept.length && !onSale.length) parts.push(nothingKept);
    if (onSale.length) parts.push(section(saleLabel, stack(saleGroups()), waitingNote));
    if (kept.length) parts.push(section("Private", stack(privateGroups())));
  } else if (shelf === "private") {
    parts.push(kept.length ? stack(privateGroups()) : nothingKept);
  } else if (shelf === "sale") {
    if (onSale.length && waitingNote) parts.push(waitingNote);
    parts.push(onSale.length ? stack(saleGroups()) : nothingOnSale);
  } else {
    parts.push(stack(downGroups()));
  }
  if (!from && (shelf === "all" || shelf === "sale")) parts.push(renderSales());
  return parts;
}

/** Inventory, showing only what one agent or app brought in, with what the owner hasn't seen marked New.
 * @param {{id: string, label: string}} source */
function seeFrom(source) {
  inventoryFrom = source;
  if (detailTask) closeTask();
  show("memories");
}

/** APP-212: which memories Inventory marks New: arrived since Lore began keeping track, and not on screen before this
 * visit. A row counts as seen once it has been on screen while Lore is in front; it keeps its mark until the next visit.
 * Memories are known here by arrival, never by id, which the store can hand out again after a delete. */
class Unseen {
  since = Number.POSITIVE_INFINITY;
  /** @type {Set<number>} */
  seen = new Set();
  /** What had been seen when this visit began. @type {Set<number>} */
  before = new Set();
  loaded = false;
  /** Rows on screen now, by memory. @type {Map<Element, number>} */
  #showing = new Map();
  /** @type {Set<number>} */
  #telling = new Set();
  #timer = 0;
  #observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) this.#showing.set(entry.target, Number(/** @type {HTMLElement} */ (entry.target).dataset.memory));
      else this.#showing.delete(entry.target);
    }
    this.#look();
  });

  constructor() {
    window.addEventListener("focus", () => this.#look());
    document.addEventListener("visibilitychange", () => this.#look());
  }

  /** @param {number} newest The newest memory, where "since" starts the first time. */
  async load(newest) {
    const kept = await window.lore.memoriesSeen(newest);
    this.since = kept.since;
    for (const arrival of kept.arrivals) this.seen.add(arrival);
    if (!this.loaded) this.visit();
    this.loaded = true;
  }

  /** A new visit: what was seen before it loses its mark. */
  visit() {
    this.before = new Set(this.seen);
  }

  /** @param {number} id */
  fresh(id) {
    return id > this.since && !this.before.has(id);
  }

  /** Inventory is drawn again: the rows it drew before are gone. */
  forget() {
    this.#observer.disconnect();
    this.#showing.clear();
  }

  /** Mark a row New while its memory is, and watch for it on screen. @param {HTMLElement} row @param {number} id */
  watch(row, id) {
    if (!this.fresh(id)) return row;
    row.querySelector(".t b")?.append(el("span", "new-mark", "New"));
    if (!this.seen.has(id)) {
      row.dataset.memory = String(id);
      this.#observer.observe(row);
    }
    return row;
  }

  #look() {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    for (const id of this.#showing.values()) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      this.#telling.add(id);
    }
    if (!this.#telling.size) return;
    window.clearTimeout(this.#timer);
    this.#timer = window.setTimeout(() => {
      const ids = [...this.#telling].slice(0, 500);
      for (const id of ids) this.#telling.delete(id);
      void window.lore.markSeen(ids).catch(() => undefined);
      if (this.#telling.size) this.#look();
    }, 300);
  }
}

const unseen = new Unseen();

function renderSales() {
  if (sales instanceof Error) return section("Sales", sales.message === SALES_ELSEWHERE ? el("div", "card pad empty", SALES_ELSEWHERE) : emptyState(sales.message, button("Try again", "secondary", () => void loadSales())));
  if (sales === null) return section("Sales", el("div", "card pad empty", "Checking your store…"));
  if (!sales.length) return section("Sales", el("div", "card pad empty", "No sales yet. When someone buys a piece, by card or through their agent, it shows here."));
  return section("Sales", card(sales.map(saleRow)), el("span", "hint", `${tally(sales)} · ${price(total(sales))} · last ${when(sales[0].sold_at)}`));
}

/** @param {Sale[]} rows */
const total = (rows) => rows.reduce((sum, sale) => sum + sale.price_usd, 0);

/** "3 sales · 2 free copies": a free copy is a reader, not a sale. @param {Sale[]} rows */
function tally(rows) {
  const free = rows.filter((sale) => sale.network === "free").length;
  const paid = rows.length - free;
  return [`${paid} ${paid === 1 ? "sale" : "sales"}`, free ? `${free} free ${free === 1 ? "copy" : "copies"}` : ""].filter(Boolean).join(" · ");
}

/** One sale: what sold, when, how it was paid, and where the payment can be seen. @param {Sale} sale */
function saleRow(sale) {
  if (sale.network === "free") return row(sale.title, `${when(sale.sold_at)} · a free copy`, cell(el("span", "value", "Free")), false);
  const byCard = sale.network === "stripe";
  const trailing = el("div", "v");
  const [where, href] = byCard ? ["Stripe", `https://dashboard.stripe.com/payments/${sale.tx}`] : ["Basescan", `${explorer(sale.network)}/tx/${sale.tx}`];
  const receipt = outLink("Receipt", href, "receipt");
  receipt.title = `See this payment on ${where}`;
  if (sale.refund_owed) trailing.append(chip("Refund owed", "attention"));
  trailing.append(el("span", "value", price(sale.price_usd)), receipt);
  // Paid for and never delivered: Lore can't send money from your wallet or Stripe account, so it says whom to refund.
  const why = byCard ? "taken down before delivery" : "not answered";
  const who = sale.payer ? `, refund ${sale.payer.slice(0, 6)}…${sale.payer.slice(-4)}` : "";
  const owed = sale.refund_owed ? ` · ${why}${who}` : "";
  return row(sale.title, `${when(sale.sold_at)} · ${byCard ? "by card" : "by an agent"}${owed}`, trailing, false);
}

const SALES_ELSEWHERE = "Sales show here once your store is open on this Mac.";

/** Read the ledger for the open store; without one there is nothing to read. */
async function loadSales() {
  salesAsked = true;
  sales = null;
  try {
    [sales, views] = snapshot?.node.url ? await Promise.all([window.lore.sales(), window.lore.views().catch(() => views)]) : [[], {}];
  } catch (error) {
    // A store opened from another Mac has no ledger to read here; anything else is worth another try.
    sales = new Error(/no deployed node/.test(reason(error, "")) ? SALES_ELSEWHERE : "Lore couldn't read your sales. Try again in a minute.");
  }
  render();
}

/** A credential's plain name and icon; the signed-in one when none is given. @param {{providerId: string} | null} [credential] @returns {[string, string]} */
function provider(credential = auth?.credentials[0] ?? null) {
  return credential ? PROVIDERS[credential.providerId] ?? [credential.providerId, ""] : ["Your AI provider", ""];
}

/** A Settings row's trailing cell. @param {(string | HTMLElement)[]} parts */
function cell(...parts) {
  const node = el("div", "v");
  node.append(...parts);
  return node;
}

/** A status pill: one shape for every state a Settings row can be in. @param {string} label @param {"ok" | "wait" | "attention" | ""} [tone] */
function pill(label, tone = "") {
  return el("span", `status-pill ${tone}`.trim(), label);
}

/** Settings → How often Lore reads them: the rhythm Lore keeps while it is open. @param {Snapshot} s */
function scheduleRow(s) {
  const label = "How often Lore reads them";
  const schedule = s.setup.schedule;
  if (!schedule) return row(label, "New memories are written from what your agents learned.", cell(pill("Not set"), button("Start", "secondary", startSetup)), false);
  if (schedule.paused) return row(label, `${runsWhen(schedule)}, paused.`, cell(pill("Paused"), button("Automations", "secondary", () => show("automations"))), false);
  const last = schedule.missed ? "Lore was closed at that hour, so it's reading now." : schedule.last_run ? `Last read ${when(schedule.last_run)}.` : "Hasn't run yet.";
  return row(label, `${runsWhen(schedule)}, while Lore is open. ${last}`, cell(pill("Scheduled", "ok")), false);
}

/** Card payments, read from Lore and, while an account waits on Stripe, from Stripe. @type {CardStatus | null | Error} */
let cards = null;
let cardsLoading = false;
let cardsRecheck = 0;

async function loadCards() {
  if (cardsLoading) return;
  cardsLoading = true;
  try {
    cards = await window.lore.cardStatus();
    // The form's notice stands only while the owner still owes Stripe the form.
    if (cards.account || cards.ready || cards.checking) drop((item) => item.text === STRIPE_FORM);
  } catch (error) {
    cards = error instanceof Error ? error : new Error(String(error));
  }
  cardsLoading = false;
  if (view === "settings") render();
}

// Coming back from Stripe's form in the browser is when the answer changes.
window.addEventListener("focus", () => { if (cards && !(cards instanceof Error) && cards.pending) void loadCards(); });

const STRIPE_FORM = "Finish with Stripe in your browser, then come back here.";

/** One way money reaches the owner, a line inside Get paid. @param {string} channel @param {string | HTMLElement} value @param {...HTMLElement} trailing */
function way(channel, value, ...trailing) {
  const node = el("div", "way");
  node.append(el("span", "way-channel", channel), typeof value === "string" ? el("span", "way-value", value) : value, cell(...trailing));
  return node;
}

/** Get paid → By card: from "Get paid to your bank" to on, without a Stripe key on this Mac. @param {Snapshot} s */
function cardWay(s) {
  const by = "By card";
  if (cards === null) { void loadCards(); return way(by, "Checking with Stripe…", pill("Checking", "wait")); }
  if (cards instanceof Error) return way(by, "Lore couldn't check card payments.", button("Try again", "quiet", () => { cards = null; render(); }));
  const status = cards;
  const switchTo = async (/** @type {string | null} */ account) => {
    const done = await act(async () => {
      await window.lore.switchCards(account);
      cards = null;
      tell(account ? (forSale(s) ? "Card payments are on. Lore is updating your store so buyers see Buy by card." : "Card payments are on. They start when your store opens.") : "Card payments are off.");
    });
    if (done) await goLive();
  };
  if (status.account) return way(by, "People, or their agents in a browser, pay by card. Stripe pays you out to your bank.", pill("On", "ok"), outLink("Stripe ↗", "https://dashboard.stripe.com"), button("Turn off", "quiet", () => void switchTo(null)));
  const finish = button(status.pending ? "Finish with Stripe" : "Get paid to your bank", "secondary", () => void act(async () => {
    await window.lore.connectCards();
    cards = null;
    tell(STRIPE_FORM);
  }));
  if (!status.pending) return way(by, "Let people, or their agents in a browser, pay by card. Stripe checks who you are and pays you out to your bank.", finish);
  if (status.ready === null) return way(by, "Lore couldn't reach Stripe to check your account.", button("Check again", "quiet", () => void loadCards()));
  if (!status.ready && status.checking) {
    // Stripe verifies what the owner entered on its own clock; look again shortly rather than waiting for a click.
    if (!cardsRecheck) cardsRecheck = window.setTimeout(() => { cardsRecheck = 0; if (view === "settings") void loadCards(); }, 10_000);
    return way(by, "Stripe is checking your details. This usually takes a minute or two.", pill("Checking", "wait"));
  }
  if (!status.ready) return way(by, "Stripe needs a few more details from you.", pill("Needs you", "attention"), finish);
  if (cardMinimum(s) !== null) return way(by, "Stripe is ready. Card payments start once you raise your price.");
  // Stripe cleared and the price can be charged: nothing is left for the owner to decide, so cards come on by themselves.
  if (!switchingCards) {
    switchingCards = true;
    void switchTo(status.pending).finally(() => { switchingCards = false; });
  }
  return way(by, "Turning on card payments…", pill("Checking", "wait"));
}

/** The card minimum, when Stripe is connected and the price is under it; null otherwise. @param {Snapshot} s */
function cardMinimum(s) {
  if (!cards || cards instanceof Error || !(cards.account || cards.ready)) return null;
  const amount = s.pricing.publication_usd;
  return typeof amount === "number" && amount >= cards.minimum_usd ? null : cards.minimum_usd;
}

/** Get paid → To your wallet: agents can also pay the wallet the store names directly. @param {Snapshot} s */
function walletWay(s) {
  const by = "To your wallet";
  const payout = s.node.live.payout;
  if (!payout) return way(by, forSale(s) ? "Lore can't see your store's wallet right now." : "You choose a wallet when your store opens.");
  const value = el("span", "way-value");
  value.append("Agents can pay it directly · ", el("span", "mono", `${payout.slice(0, 6)}…${payout.slice(-4)}`));
  return way(by, value, outLink("View ↗", `${explorer(s.node.live.network)}/address/${payout}`));
}

/** Settings → Your store → Get paid: every way money reaches the owner, in one row. @param {Snapshot} s */
function getPaidRow(s) {
  const node = row("Get paid", "Payments go straight to you. Lore never holds the money.", undefined, false);
  node.classList.add("stacked");
  const ways = el("div", "ways");
  ways.append(cardWay(s), walletWay(s));
  node.append(ways);
  return node;
}

/** "first 3 copies free", or nothing from a CLI that predates free copies. @param {number | undefined} count */
function freeCopies(count) {
  if (typeof count !== "number") return "";
  return count === 0 ? "no free copies" : count === 1 ? "first copy free" : `first ${count} copies free`;
}

/** Settings → Your store → Price: the one number, its free copies, and the one way to change both. @param {Snapshot} s */
function priceSetting(s) {
  const set = typeof s.pricing.publication_usd === "number";
  const value = set ? [`${price(s.pricing.publication_usd)} per piece`, freeCopies(s.pricing.free_copies)].filter(Boolean).join(" · ") : "Not set";
  const detail = el("span");
  detail.append(el("span", "", "What buyers pay for each piece, by card or through their AI agent."));
  const minimum = cardMinimum(s);
  if (minimum !== null) detail.append(el("span", "row-warn", `Card payments need at least ${price(minimum)} a piece. Buyers can't pay by card until you raise it.`));
  // One editor, on For Sale. Every other surface reads the same numbers and
  // sends the owner there rather than growing a second field.
  return row("Price", detail, cell(el("span", "value", value), button(set ? "Change" : "Set a price", "quiet", openPriceEditor)), false);
}

/** Settings → Your store → Address: where buyers find the store, whether it answers, and one way to open it. @param {Snapshot} s */
function addressRow(s) {
  const live = s.node.live;
  if (!s.node.url) return row("Address", "Where buyers find your pieces once your store opens.", cell(pill("Not open"), button("Open your store", "secondary", () => void startDeploy())), false);
  const home = s.node.url.replace(/\/mcp$/, "");
  const detail = el("span", "address");
  detail.append(el("span", "mono", home.replace(/^https?:\/\//, "")));
  const console = workerConsole(s.node.url);
  if (console) detail.append(outLink("Hosted on Cloudflare ↗", console, "quiet-link"));
  return row("Address", detail, cell(pill(nodeLabel(s.node), live.state === "online" ? "ok" : live.state === "unreachable" ? "attention" : ""), outLink("Open ↗", home)), false);
}

/** Read the listing state once per store address; Settings re-renders when it lands. @param {Snapshot} s */
function loadListing(s) {
  if (!s.node.url || !forSale(s) || listingFor === s.node.url) return;
  listingFor = s.node.url;
  listing = null;
  window.lore.listingStatus().then((state) => {
    if (listingFor !== s.node.url) return;
    listing = state;
    if (view === "settings") render();
  }, () => {
    listingFor = "";
  });
}

/** List or delist; listing opens the request form in the browser. @param {"list" | "delist"} action */
async function changeListing(action) {
  await act(async () => {
    listing = await window.lore.listStore(action);
    if (listing.url) window.open(listing.url);
    render();
  });
}

/** Settings → Your store → Marketplace: one row, read from the public list and the store's own switch. @param {Snapshot} s */
function marketplaceRow(s) {
  if (!forSale(s)) return [];
  loadListing(s);
  const label = "Marketplace";
  const shares = "It shows only what your store already shows: your name, topics, and prices.";
  if (!listing) return [row(label, "Checking the public list of Lore sellers…", cell(pill("Checking", "wait")), false)];
  if (listing.state === "listed") {
    return [row(label, `Anyone can find your store in the public list of Lore sellers. ${shares}`, cell(pill("Listed", "ok"), button("Delist", "quiet", () => void changeListing("delist"))), false)];
  }
  if (listing.action === "delist") return [row(label, "Your store leaves the public list within a day.", cell(pill("Pending", "wait"), button("Stay listed", "quiet", () => void changeListing("list"))), false)];
  if (listing.url) {
    const what = "Send the request on the page that opened. It needs a free GitHub account. You'll get a reply on that page within a few minutes.";
    return [row(label, what, cell(pill("Pending", "wait"), outLink("Open the request ↗", listing.url), button("Cancel", "quiet", () => void changeListing("delist"))), false)];
  }
  return [row(label, `Let buyers find your store in the public list of Lore sellers. ${shares}`, cell(button("List on the marketplace", "secondary", () => void changeListing("list"))), false)];
}

/** How a connection stands, said the same way on its row and its sheet, in the app's own nouns.
 * Connected with nothing in it is still connected. @type {Record<SourceState, {ok: boolean, label: string, line: (app: SourceApp, source: SourceEntry) => string}>} */
const CONNECTION_STATES = {
  connected: { ok: true, label: "Connected", line: (app, source) => (source.imported ? `${plural(source.imported, app.item)} kept.` : `No ${many(app.item)} yet.`) },
  nothing_found: { ok: true, label: "Connected", line: (app) => `No ${many(app.item)} yet.` },
  needs_permission: { ok: false, label: "Needs access", line: (app) => `Lore can't read this ${app.unit} yet.` },
  unreachable: { ok: false, label: "Not found", line: (app) => `The ${app.unit} is gone or moved.` },
  off: { ok: false, label: "Off", line: () => "Not reading." }
};

/** Said once an app brings something new in: Lore reads it through in the background. */
const READING = "Lore is turning them into memories now.";

/** An app Lore signs in to fails one way as far as the owner can act on it: sign in again. */
const SIGNED_OUT = { ok: false, label: "Signed out", line: (/** @type {SourceApp} */ app) => `${app.name} didn't answer. Sign in again.` };

/** @param {SourceApp} app @param {SourceEntry} source */
function stateOf(app, source) {
  const state = CONNECTION_STATES[source.state ?? "off"];
  return app.kind === "mcp" && !state.ok && source.state !== "off" ? SIGNED_OUT : state;
}

/** @param {number} count @param {string} noun */
function plural(count, noun) {
  return `${count} ${count === 1 ? noun : many(noun)}`;
}

/** @param {string} noun */
function many(noun) {
  return `${noun.replace(/y$/, "ie")}s`;
}

/** A bundled brand mark by asset name, the initial when none loads. @param {string} asset @param {string} name */
function brand(asset, name) {
  // Grok Bot's mark is already a whole app tile; framing it in another tile reads as a box in a box.
  const node = el("img", asset === "grok" ? "logo full" : "logo");
  node.src = `assets/${asset}.svg`;
  node.alt = "";
  node.addEventListener("error", () => node.replaceWith(el("span", "logo initial", name[0])), { once: true });
  return node;
}

/** The app's own mark. @param {SourceApp} app */
function logo(app) {
  return brand(app.id, app.name);
}

/** The agents' marks: their makers' marks, as sign-in draws them. @type {Record<string, string>} */
const AGENT_MARKS = { codex: "openai", claude: "claude" };

/** What connecting an app is called: an export is brought in once, an app with its own server is
 * signed in to, everything else stays connected. @param {SourceApp} app */
function verb(app) {
  return app.kind === "export" ? "Import" : app.kind === "mcp" ? "Sign in" : "Connect";
}

/** Connectors: the agents, then every app in the catalog, connected or on offer. @param {Snapshot} s */
function sourceRows(s) {
  const rows = s.library.sources.filter((source) => !source.connector).map((source) => {
    const action = source.enabled ? button("Manage", "quiet", () => openHistory(source)) : button("Connect", "secondary", () => openHistory(source));
    const node = row(source.label, source.enabled ? `${plural(source.imported, "memory")} imported` : "What it remembers about your work", cell(...(source.enabled ? [pill("Connected", "ok")] : []), action), false);
    node.prepend(brand(AGENT_MARKS[source.name] ?? source.name, source.label));
    return node;
  });
  for (const app of apps) {
    // The owner's personal agents have a group of their own.
    if (app.id === "agent") continue;
    const connected = s.library.sources.filter((source) => source.connector === app.id);
    for (const source of connected) {
      const state = stateOf(app, source);
      const node = row(app.name, source.label === app.name ? state.line(app, source) : `${source.label} · ${state.line(app, source)}`, cell(pill(state.label, state.ok ? "ok" : source.state === "off" ? "" : "attention"), button("Manage", "quiet", () => openConnection(app, source))), false);
      node.prepend(logo(app));
      rows.push(node);
    }
    // A vault is one place and an export is one history, each changed from its sheet; newsletters add up.
    if (!connected.length || app.kind === "feed") {
      const node = row(app.name, app.what, cell(button(connected.length ? `${verb(app)} another` : verb(app), "secondary", () => void openConnect(app))), false);
      node.prepend(logo(app));
      rows.push(node);
    }
  }
  return rows;
}

const CHEVRON = `<svg class="form-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10l4-4 4 4M8 14l4 4 4-4"></path></svg>`;

/** APP-201: the one sheet for setting a value anywhere in the app. An optional borderless title, a prompt that grows
 * as it fills, grouped rows of label and control, and a footer whose primary waits until the form is valid. A native
 * modal, so Escape closes it and focus stays inside; ⌘↩ submits from any field. */
class FormSheet {
  /** @param {string} heading @param {HTMLElement} [icon] */
  constructor(heading, icon) {
    closeSheet();
    this.dialog = el("dialog", "sheet form-sheet");
    this.dialog.setAttribute("aria-label", heading);
    this.form = el("form", "form-panel");
    // Lore says what is wrong with a field in its own words, in the sheet; the browser's bubbles would say it twice.
    this.form.noValidate = true;
    const head = el("header", "form-head");
    const close = el("button", "icon-btn", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => this.close());
    head.append(...(icon ? [icon] : []), el("h2", "", heading), close);
    this.body = el("div", "form-body");
    this.problem = problemLine();
    this.aside = el("div", "form-aside");
    this.actions = el("div", "actions");
    const foot = el("footer", "form-foot");
    foot.append(this.aside, this.actions);
    this.form.append(head, this.body, foot);
    this.dialog.append(this.form);
    /** @type {HTMLButtonElement | null} */
    this.primary = null;
    this.valid = () => true;
    /** @type {() => unknown} */
    this.submit = () => undefined;
    this.failed = "";
    /** @type {string | undefined} */
    this.working = undefined;
    this.busy = false;
    this.form.addEventListener("input", () => this.refresh());
    // ⌘↩ anywhere, and ↩ in a one-line field, as a native form would.
    this.form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if (!(event.metaKey || event.ctrlKey || event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      this.form.requestSubmit();
    });
    this.form.addEventListener("submit", (event) => { event.preventDefault(); void this.run(); });
    // The form fills the dialog, so a click that lands on the dialog itself came from the backdrop.
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.close(); });
    this.dialog.addEventListener("close", () => this.dialog.remove());
  }

  /** A large borderless name; Enter moves on to the prompt. @param {string} placeholder */
  title(placeholder) {
    const field = this.watch(el("input", "form-title"));
    field.type = "text";
    field.placeholder = placeholder;
    field.setAttribute("aria-label", placeholder);
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      /** @type {HTMLElement | null} */ (this.body.querySelector("textarea"))?.focus();
    });
    this.body.append(field);
    return field;
  }

  /** @param {string} label @param {string} [placeholder] */
  prompt(label, placeholder = label) {
    const area = this.watch(el("textarea", "form-prompt"));
    area.placeholder = placeholder;
    area.setAttribute("aria-label", label);
    this.body.append(area);
    return area;
  }

  /** A line of explanation above the rows. @param {string} text @param {string} [className] */
  text(text, className = "form-lead") {
    const node = el("p", className, text);
    this.body.append(node);
    return node;
  }

  /** Rows inside one rounded container, under a muted heading. @param {string} heading @param {HTMLElement[]} rows */
  group(heading, rows) {
    const node = el("section", "form-group");
    if (heading) node.append(el("h3", "", heading));
    const list = el("div", "form-rows");
    list.append(...rows);
    node.append(list);
    this.body.append(node);
    return node;
  }

  /** @param {string} label @param {...HTMLElement} controls */
  row(label, ...controls) {
    const node = el("label", "form-row");
    node.append(el("span", "form-label", label), ...controls);
    return node;
  }

  /** The value and a chevron, with the real select laid over the whole row, so the keyboard and screen readers get
   * the platform's own. @param {string} label @param {Array<[string, string]>} options @param {string} value */
  select(label, options, value) {
    const control = this.watch(el("select"));
    control.setAttribute("aria-label", label);
    for (const [key, text] of options) {
      const option = el("option", "", text);
      option.value = key;
      control.append(option);
    }
    control.value = value;
    const shown = el("span", "form-value");
    const show = () => { shown.textContent = control.selectedOptions[0]?.textContent ?? ""; };
    control.addEventListener("change", show);
    show();
    const node = this.row(label, shown, control);
    node.classList.add("pick");
    shown.insertAdjacentHTML("afterend", CHEVRON);
    return { row: node, control };
  }

  /** A row edited in place on its right.
   * @param {string} label @param {{type?: string, placeholder?: string, inputMode?: string, value?: string, ariaLabel?: string}} props @param {string} [prefix] */
  field(label, { type = "text", placeholder = "", inputMode = "", value = "", ariaLabel = label }, prefix = "") {
    /** @type {HTMLInputElement} */
    const control = this.watch(el("input"));
    Object.assign(control, { type, placeholder, inputMode, value });
    control.setAttribute("aria-label", ariaLabel);
    const entry = el("span", "form-entry");
    if (prefix) entry.append(el("span", "form-prefix", prefix));
    entry.append(control);
    return { row: this.row(label, entry), control };
  }

  /** Muted words beside the buttons. @param {string} text */
  note(text) {
    this.aside.append(el("p", "hint", text));
  }

  /** A button that is not the primary: quiet ones sit left, by the note. @param {string} label @param {"secondary" | "quiet"} kind @param {() => void} run */
  button(label, kind, run) {
    const node = button(label, kind, run);
    (kind === "quiet" ? this.aside : this.actions).append(node);
    return node;
  }

  /** Show it, with `primary` waiting on `valid` and doing `submit`. The sheet closes once `submit` settles, unless it
   * answers false; what it throws is said in the sheet, under the rows.
   * @param {{primary?: string, working?: string, valid?: () => boolean, submit?: () => unknown, failed?: string}} [spec] */
  open(spec) {
    this.arm(spec);
    return this.show();
  }

  show() {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.focus();
    return this;
  }

  /** The footer's primary and what it does, as `open` takes them; a sheet that goes through steps arms each one.
   * @param {{primary?: string, working?: string, valid?: () => boolean, submit?: () => unknown, failed?: string}} [spec] */
  arm({ primary, working, valid = () => true, submit = () => undefined, failed = "Lore couldn't do that. Try again." } = {}) {
    Object.assign(this, { valid, submit, failed, working });
    this.body.append(this.problem);
    if (primary) {
      this.primary = el("button", "btn primary sm", primary);
      this.primary.type = "submit";
      this.actions.append(this.primary);
    }
    this.refresh();
  }

  /** Clear the sheet for its next step, in place. */
  /** A new heading and mark for a sheet that moves on to its next step. @param {string} text @param {HTMLElement} icon */
  heading(text, icon) {
    const head = /** @type {HTMLElement} */ (this.form.querySelector(".form-head"));
    head.querySelector("img.logo, .mark")?.replaceWith(icon);
    /** @type {HTMLElement} */ (head.querySelector("h2")).textContent = text;
    this.dialog.setAttribute("aria-label", text);
  }

  reset() {
    this.body.replaceChildren();
    this.aside.replaceChildren();
    this.actions.replaceChildren();
    this.primary = null;
    this.problem.textContent = "";
  }

  focus() {
    /** @type {HTMLElement | null} */ (this.body.querySelector("input:not([type=radio]), textarea") ?? this.form.querySelector(".btn.primary:not(:disabled)") ?? this.form.querySelector(".actions .btn:not(:disabled)") ?? this.form.querySelector(".form-foot .btn:not(:disabled)"))?.focus();
  }

  close() {
    this.dialog.close();
  }

  refresh() {
    if (this.primary) this.primary.disabled = this.busy || !this.valid();
  }

  async run() {
    const primary = this.primary;
    if (!primary || primary.hidden || this.busy || !this.valid()) return;
    const label = primary.textContent;
    this.busy = true;
    this.refresh();
    this.problem.textContent = "";
    if (this.working) primary.textContent = this.working;
    try {
      if (await this.submit() !== false) this.close();
    } catch (error) {
      if (this.dialog.isConnected) this.problem.textContent = reason(error, this.failed);
    }
    this.busy = false;
    primary.textContent = label;
    this.refresh();
  }

  /** A control that re-checks the form as it changes, even from an event that does not bubble.
   * @template {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} T @param {T} control */
  watch(control) {
    control.addEventListener("input", () => this.refresh());
    control.addEventListener("change", () => this.refresh());
    return control;
  }
}

/** A quiet line in a sheet for what went wrong there, so the owner corrects it in place. */
function problemLine() {
  const node = el("p", "problem");
  node.setAttribute("role", "alert");
  return node;
}

/** Connect from a sheet: it closes once the app is read, says in place why not, and closing it first
 * stops the connect. @param {FormSheet} form @param {SourceApp} app
 * @param {() => Promise<SourceEntry>} work @returns {Promise<boolean>} Whether it connected. */
async function connectIn({ dialog, problem }, app, work) {
  const stop = () => void window.lore.cancelConnect();
  dialog.addEventListener("close", stop);
  problem.textContent = "";
  try {
    const added = await work();
    dialog.removeEventListener("close", stop);
    dialog.close();
    tell(`${app.name} is connected. ${stateOf(app, added).line(app, added)}${added.added ? ` ${READING}` : ""}`, false, added.imported ? sellAction(added) : undefined);
    return true;
  } catch (error) {
    if (dialog.isConnected) problem.textContent = reason(error, `${app.name} didn't answer. Try again.`);
    return false;
  } finally {
    dialog.removeEventListener("close", stop);
    await load();
  }
}

/** Connect an app: pick among what it offers, choose a folder or file, or give an address, and Lore
 * reads it. Changing what a connected app reads swaps the place only once the new one has been read,
 * and keeps the memories. @param {SourceApp} app @param {SourceEntry} [current] */
async function openConnect(app, current) {
  if (app.kind === "mcp") return openSignIn(app);
  const { name, unit, kind } = app;
  let locator = "";
  /** What Lore is to read: the choice picked, or the address typed. */
  let chosen = () => locator;
  /** @type {SourceChoice[]} */
  let choices = [];
  if (kind !== "feed") {
    try {
      choices = await window.lore.sourceChoices(app.id);
    } catch (error) {
      tell(reason(error, "Lore could not look for that."), true);
      return;
    }
  }
  const form = new FormSheet(name, logo(app));
  const lead = form.text(kind === "feed" ? `Where is your ${unit}?` : choices.length ? `Choose a ${unit}.` : kind === "folder" ? `No ${many(unit)} found on this Mac.` : `Choose the ${unit} you downloaded.`);
  if (app.guide) form.text(app.guide, "hint");
  const rows = /** @type {HTMLElement} */ (form.group("", []).querySelector(".form-rows"));
  /** @param {SourceChoice} choice @param {boolean} checked */
  function option(choice, checked) {
    const radio = el("input");
    radio.type = "radio";
    radio.name = "choice";
    radio.addEventListener("change", () => { locator = choice.locator; form.refresh(); });
    const row = form.row(choice.label, el("span", "hint mono", choice.locator), radio);
    row.classList.add("form-option");
    rows.append(row);
    if (checked) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
  }
  if (kind === "feed") {
    const { row, control } = form.field("Address", { type: "url", placeholder: app.placeholder, ariaLabel: `${name} address` });
    chosen = () => control.value.trim();
    rows.append(row);
  } else {
    for (const choice of choices) option(choice, false);
    const pick = kind === "folder" ? () => window.lore.pickFolder() : () => window.lore.pickFiles().then((paths) => paths[0] ?? null);
    form.button(kind === "folder" ? "Choose a folder…" : "Choose a file…", "quiet", () => void pick().then((path) => {
      if (path) option({ label: path.split("/").at(-1) ?? path, locator: path, open: false }, true);
    }));
  }
  form.note("Read only. Stays on this Mac.");
  form.open({
    primary: kind === "export" ? "Import" : `Connect ${name}`,
    valid: () => Boolean(chosen()),
    submit: () => connectIn(form, app, () => window.lore.connectSource({ connector: app.id, locator: chosen(), ...(current ? { replace: current.name } : {}) }))
  });
}

/** Sign in to an app that runs its own server: its own page, in the browser, lets Lore in, and Lore
 * then reads it. Closing the sheet stops the wait. @param {SourceApp} app */
function openSignIn(app) {
  const { name } = app;
  const invite = `Lore opens ${name} in your browser. Approve there, and Lore brings in ${app.what.toLowerCase()}.`;
  const form = new FormSheet(name, logo(app));
  const lead = form.text(invite);
  form.note("Read only. Stays on this Mac.");
  form.open({
    primary: `Sign in to ${name}`,
    submit: async () => {
      const start = /** @type {HTMLButtonElement} */ (form.primary);
      lead.textContent = "Waiting for you to approve in your browser…";
      start.hidden = true;
      const cancel = form.button("Cancel", "secondary", () => form.close());
      if (await connectIn(form, app, () => window.lore.signIn(app.id))) return true;
      lead.textContent = invite;
      cancel.remove();
      start.hidden = false;
      start.focus();
      return false;
    }
  });
}

/** What a connected app reads, where it stands, and what can be done to it. @param {SourceApp} app @param {SourceEntry} source */
function openConnection(app, source) {
  const { name, unit } = app;
  const state = stateOf(app, source);
  const sell = sellAction(source);
  const signedOut = state === SIGNED_OUT;
  const form = new FormSheet(name, logo(app));
  form.text(source.label === name ? state.line(app, source) : `${source.label} · ${state.line(app, source)}`);
  if (app.kind !== "mcp") form.text(source.locator ?? "", "hint mono");
  const standing = source.refresh === false ? `Read once. Change ${unit} to bring in a newer one.` : snapshot?.setup.schedule && !snapshot.setup.schedule.paused ?`Lore looks for new ${many(app.item)} each time your schedule runs.` : `Lore looks for new ${many(app.item)} only when you choose Read again.`;
  form.text(standing, "hint");
  form.button("Disconnect", "quiet", ask);
  if (app.kind === "mcp") form.button("Sign in again", signedOut ? "secondary" : "quiet", () => openSignIn(app));
  else form.button(`Change ${unit}`, "quiet", () => void openConnect(app, source));
  if (source.imported) form.button(sell.label, "secondary", sell.run);
  if (!signedOut && source.state === "needs_permission") form.button("Open System Settings", "secondary", () => void window.lore.openPrivacySettings());
  else if (!signedOut && source.refresh !== false) form.button("Read again", "secondary", () => void act(async () => {
    const [read] = await window.lore.readSource(source.name);
    form.close();
    tell(read?.added ? `${plural(read.added, `new ${app.item}`)}. ${READING}` : "Nothing new.");
  }));
  form.open();
  function ask() {
    const kept = source.imported ? ` The ${plural(source.imported, "memory")} it brought in ${source.imported === 1 ? "stays" : "stay"} in your library.` : "";
    const which = source.label || name;
    const confirm = new FormSheet(`Disconnect ${which}?`, logo(app));
    confirm.text(`Lore stops reading ${which}.${kept}`);
    if (source.imported) confirm.button("Delete them too", "quiet", () => void remove(false)).classList.add("destructive");
    confirm.button("Cancel", "secondary", () => openConnection(app, source));
    confirm.button("Disconnect", "secondary", () => void remove(true));
    confirm.open();
  }
  /** @param {boolean} keep */
  async function remove(keep) {
    await act(async () => {
      const { memories } = await window.lore.removeSource(source.name, keep);
      closeSheet();
      tell(memories.deleted ? `Disconnected. ${plural(memories.deleted, "memory")} deleted.` : `Disconnected. ${plural(memories.kept, "memory")} kept.`);
    });
  }
}

/** Connectors: the owner's own agents, then where memories come from, and how often Lore reads them. First class: the
 * way context gets into Lore, not a preference. @param {Snapshot} s */
function renderConnectors(s) {
  return [section("Your agents", agentTiles(s)), section("Your apps", tiles(sourceRows(s))), section("", card([scheduleRow(s)]))];
}

/** Rows as a grid of tiles, each opened by a click anywhere on it. @param {HTMLElement[]} rows */
function tiles(rows) {
  const grid = el("div", "tiles");
  for (const node of rows) {
    node.classList.add("tile");
    node.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      // A link in its text goes where it says; the tile opens its own action.
      /** @type {HTMLButtonElement | null} */ (node.querySelector("button:not(.inline)"))?.click();
    });
    grid.append(node);
  }
  return grid;
}

/** The apps a personal agent can be, by what the owner calls them, each with its mark. @type {Array<[AgentApp, string]>} */
const AGENT_APPS = [["grok", "Grok Bot"], ["muse", "Muse"], ["chatgpt", "ChatGPT"], ["claude", "Claude"], ["other", "Other"]];
/** @type {Record<AgentApp, string>} */
const PERSONAL_MARKS = { grok: "grok", muse: "muse", chatgpt: "chatgpt", claude: "claude", other: "agent" };
const STORE_FIRST = "Your agents work online, so they need a place online to save to. Lore sets one up for you, free on Cloudflare. Only your agents can save to it, and nothing goes on sale until you choose to sell it.";
/** APP-217: how each agent takes Lore's private link, as its maker documents it (checked Oct 17, 2026). Grok Bot adds
 * a connector it is sent in chat, so it gets a message around the link; `routine` is what each calls a scheduled ask.
 * `again` is the same for a new link, which replaces the Lore connector the agent already has rather than adding one;
 * `or` is the quiet alternative under the last step, and `brief` the steps as one line, for the first-run chat. Grok Bot
 * has no menu to add a connector by hand: the message pasted into its chat is the only documented way (APP-217).
 * @typedef {{steps: string[], brief?: string, message?: string, or?: string}} AgentSteps
 * @type {Partial<Record<AgentApp, {first: AgentSteps, again: AgentSteps, note?: string, routine: string}>>} */
const AGENT_GUIDES = {
  grok: {
    first: { steps: ["Copy the message", "Paste it into Grok Bot's chat", "Lore shows when the first save arrives"], brief: "Copy this message and paste it into a Grok Bot chat.", message: "Add this MCP server to my account: " },
    again: { steps: ["Copy the message", "Paste it into Grok Bot's chat", "Lore shows when the next save arrives"], message: "Replace the Lore MCP server in my account with this one: " },
    routine: "routine"
  },
  claude: {
    first: { steps: ["In Claude, open Customize › Connectors, then + Add › Add custom connector", "Name it Lore, paste the link below, and choose Continue", "Choose No sign in, then Add"] },
    again: { steps: ["In Claude, open Customize › Connectors", "Open the Lore connector you added before and replace its link with this one"], or: "Or remove it and add a new one named Lore with this link" },
    note: "Claude's free plan allows one custom connector.",
    routine: "scheduled task"
  },
  chatgpt: {
    first: { steps: ["In ChatGPT, open Plugins, then + › Add custom MCP server", "Name it Lore, paste the link below, choose No authentication, and continue", "Choose Create"] },
    again: { steps: ["In ChatGPT, open Plugins", "Open the Lore connector you added before and replace its link with this one"], or: "Or remove it and add a new one named Lore with this link" },
    note: "Saving to Lore needs a ChatGPT plan that allows custom connectors to write.",
    routine: "scheduled task"
  }
};
const EVERY_EVENING = "Every evening, save anything new you learned about me to Lore.";
/** While the setup sheet waits on a first save, it asks the store this often, not once a minute. */
const FIRST_SAVE_EVERY_MS = 10_000;

/** @param {AgentApp | null | undefined} app @param {string} name */
function agentMark(app, name) {
  return brand(app && Object.hasOwn(PERSONAL_MARKS, app) ? PERSONAL_MARKS[app] : "agent", name);
}

/** @param {string} iso */
function day(iso) {
  const date = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? "today" : days === 1 ? "yesterday" : when(iso);
}

/** What an agent has saved, as its store counts it, or what Lore kept of it while the store has not answered. @param {SourceEntry} source */
function agentLine(source) {
  const entry = agents?.find((agent) => agent.source === source.name);
  if (!entry) return source.imported ? `${plural(source.imported, "memory")} kept` : "Nothing saved yet";
  return entry.saved ? `Saved ${entry.saved}${entry.last_saved_at ? ` · last ${day(entry.last_saved_at)}` : ""}` : "Nothing saved yet";
}

/** An agent's line on its card, its "Saved N" one click from what it saved. @param {SourceEntry} source */
function agentDetail(source) {
  const line = agentLine(source);
  const saved = agents?.find((agent) => agent.source === source.name)?.saved;
  if (!saved) return line;
  const node = el("span");
  node.append(inline(`Saved ${saved}`, () => seeFrom({ id: source.name, label: source.label })), line.slice(`Saved ${saved}`.length));
  return node;
}

/** What an agent's own history on this Mac is, in the owner's words. @type {Record<string, string>} */
const HISTORIES = {
  codex: "the memory notes Codex keeps on this Mac",
  claude: "the memory notes Claude Code keeps for each of your projects on this Mac"
};

/** Codex's or Claude Code's own memory on this Mac: connect it, or turn it off and keep what it brought. @param {SourceEntry} source */
function openHistory(source) {
  const form = new FormSheet(source.enabled ? source.label : `Connect ${source.label}`, brand(AGENT_MARKS[source.name] ?? source.name, source.label));
  const what = HISTORIES[source.name] ?? `what ${source.label} keeps on this Mac`;
  if (source.enabled) {
    form.text(`Lore reads ${what}. ${plural(source.imported, "memory")} so far.`);
    form.note("Turning it off keeps what it already brought in.");
    form.open({
      primary: "Turn off",
      working: "Turning off…",
      failed: "Lore couldn't turn it off. Try again.",
      submit: async () => {
        await window.lore.switchSource(source.name, false);
        tell(`Turned off ${source.label}. What it brought in stays.`);
        await load();
      }
    });
    return;
  }
  form.text(`Lore reads ${what} and turns what's new into private memories.`);
  form.note("Read only. Stays on this Mac.");
  form.open({
    primary: "Connect",
    working: "Connecting…",
    failed: "Lore couldn't connect it. Try again.",
    submit: async () => {
      await window.lore.switchSource(source.name, true);
      await load();
      void window.lore.readSource(source.name).then(() => load()).catch(() => undefined);
    }
  });
}

/** Each personal agent the owner connected, and the way to connect one more. @param {Snapshot} s */
function agentTiles(s) {
  const rows = s.library.sources.filter((source) => source.connector === "agent").map((source) => {
    const line = agentLine(source);
    const node = row(source.label, agentDetail(source), cell(line === "Nothing saved yet" ? pill("Waiting", "wait") : pill("Live", "ok"), button("Manage", "quiet", () => openAgent(source))), false);
    node.prepend(agentMark(source.app, source.label));
    return node;
  });
  const connect = () => new AgentSetup().open();
  if (rows.length) {
    const more = row("Connect another agent", "Grok Bot, ChatGPT or Claude", cell(button("Connect", "secondary", connect)), false);
    more.prepend(agentMark("other", "Agent"));
    more.classList.add("tile-add");
    return tiles([...rows, more]);
  }
  const hero = row("Connect an agent", "Grok Bot, ChatGPT or Claude saves what it learns about you. It stays private until you approve a piece.", cell(button("Connect an agent", "primary", connect)), false);
  const stack = el("div", "mark-stack");
  for (const [app, name] of AGENT_APPS.filter(([id]) => id !== "other" && id !== "muse")) stack.append(agentMark(app, name));
  hero.prepend(stack);
  hero.classList.add("agent-hero");
  return hero;
}

async function loadAgents() {
  if (!snapshot?.library.sources.some((source) => source.connector === "agent")) return;
  agents = await window.lore.agents().catch(() => agents);
  if (view === "connectors") render();
}

/** A quiet line inside a sheet, the way the app's notices look, for what the owner should keep in mind. @param {string} text */
function inlineNotice(text) {
  const box = el("div", "notice info inline-notice");
  box.insertAdjacentHTML("afterbegin", INFO_ICON);
  box.append(el("span", "", text));
  return box;
}

/** A Copy button that says it copied. @param {() => string} text @param {string} [label] */
function copyButton(text, label = "Copy") {
  const node = button(label, "quiet", () => void window.lore.copy(text()).then(() => {
    node.textContent = "Copied";
    setTimeout(() => { node.textContent = label; }, 1500);
  }));
  return node;
}

/** The one link an agent needs, its key masked, copied whole; with `lead`, the message around it that the agent needs
 * instead. @param {AgentKey} handed @param {string} [lead] @param {string} [label] */
function privateLink(handed, lead = "", label = "Copy") {
  const link = el("button", lead ? "agent-link agent-message" : "agent-link");
  link.type = "button";
  link.setAttribute("aria-label", lead ? label : "Copy link");
  const shown = el("span", "agent-link-text");
  const address = el("span", "agent-link-url");
  address.append(handed.mcp_url.replace(/^https?:\/\//, "") + "/", el("span", "agent-link-key", "••••••••••••"));
  if (lead) {
    // APP-218: a plain name for what gets pasted, and the message itself quietly under it, never broken inside its link.
    const quote = el("span", "agent-link-quote", lead);
    quote.append(address);
    shown.append(el("span", "agent-link-lead", `Message for ${handed.agent.name}`), quote);
  } else shown.append(address);
  const glyph = el("span", "agent-link-icon");
  glyph.innerHTML = COPY_ICON;
  const word = el("span", "agent-link-word", label);
  link.append(shown, glyph, word);
  link.addEventListener("click", () => void window.lore.copy(lead + handed.connector_url).then(() => {
    link.classList.add("copied");
    glyph.innerHTML = CHECK_ICON;
    word.textContent = "Copied";
    setTimeout(() => { link.classList.remove("copied"); glyph.innerHTML = COPY_ICON; word.textContent = label; }, 1500);
  }));
  return link;
}

/** After its first save, an agent can be asked to save every evening on its own schedule. Optional, so quiet.
 * @param {AgentApp | null | undefined} app @param {string} who */
function eveningOffer(app, who) {
  const kind = app ? AGENT_GUIDES[app]?.routine : undefined;
  if (!kind) return null;
  const offer = el("div", "agent-next");
  const words = el("div", "agent-next-words");
  words.append(el("span", "", `Optional: paste this into ${who} as a ${kind}, so it saves every evening.`), el("span", "agent-next-quote", `“${EVERY_EVENING}”`));
  offer.append(words, copyButton(() => EVERY_EVENING));
  return offer;
}

/** APP-207: connecting one of the owner's personal agents, in one sheet: their store online first if it isn't yet,
 * then which agent, then what to paste into it, shown once, then its first save. */
class AgentSetup {
  constructor() {
    this.form = new FormSheet("Connect an agent", agentMark("other", "Agent"));
    /** The agent apps on this Mac, so the sheet can open the one being connected (APP-216). */
    this.installed = window.lore.agentApps().catch(() => /** @type {AgentApp[]} */ ([]));
  }

  open() {
    if (snapshot?.node.url) this.pick();
    else this.store();
  }

  /** The store goes online the way it always does, in its own thread; the sheet comes back once it is. */
  store() {
    this.form.text(STORE_FIRST);
    this.form.open({
      primary: "Put your store online",
      submit: () => {
        agentAfterStore = true;
        void startDeploy(AGENT_STORE_INTENT);
      }
    });
  }

  pick() {
    const { form } = this;
    form.text("Which agent should save to Lore?");
    const rows = /** @type {HTMLElement} */ (form.group("", []).querySelector(".form-rows"));
    /** @type {[AgentApp, string] | null} */
    let chosen = null;
    for (const [app, label] of AGENT_APPS) {
      const radio = el("input");
      radio.type = "radio";
      radio.name = "agent";
      radio.disabled = app === "muse";
      radio.addEventListener("change", () => {
        chosen = [app, app === "other" ? "My agent" : label];
        form.refresh();
      });
      const option = radio.disabled ? form.row(label, el("span", "hint", "Coming soon"), radio) : form.row(label, radio);
      option.classList.add("form-option");
      option.prepend(agentMark(app, label));
      rows.append(option);
    }
    form.note("What it saves stays private on this Mac.");
    form.open({
      primary: "Connect",
      working: "Connecting…",
      valid: () => Boolean(chosen),
      failed: "Lore couldn't connect it. Try again.",
      submit: async () => {
        if (!chosen) return false;
        const handed = await window.lore.connectAgent({ app: chosen[0], name: chosen[1] });
        void load().then(loadAgents);
        this.steps(handed, true, await this.installed);
        return false;
      }
    });
  }

  /** What to paste into the agent, with its key shown this once; a first connect then waits for the first save.
   * @param {AgentKey} handed @param {boolean} first @param {AgentApp[]} installed */
  steps(handed, first, installed) {
    const { form } = this;
    const { name: who, app } = handed.agent;
    const where = app === "other" ? who : AGENT_APPS.find(([id]) => id === app)?.[1] ?? who;
    form.reset();
    form.heading(first ? `Connect ${where}` : `A new link for ${who}`, agentMark(app, where));
    /** @param {string} label @param {string} shown @param {string} text */
    const copyRow = (label, shown, text) => {
      const node = form.row(label, el("span", "hint mono", shown), copyButton(() => text));
      node.classList.add("copy-row");
      return node;
    };
    const guide = agentGuide(handed, first);
    if (guide) form.body.append(...guide);
    else {
      const list = el("ol", "agent-steps");
      for (const step of [`In ${where}'s settings, find where to add a connector.`, "Add one named “Lore” with the link below, or with the address and key if it asks for both.", `Add the instructions where ${where} keeps standing instructions, like custom instructions or a skill, so it remembers what to save in every chat.`]) list.append(el("li", "", step));
      form.body.append(list, privateLink(handed));
    }
    const hint = el("span", "form-hint quiet-hint");
    hint.innerHTML = LOCK_ICON;
    hint.append(el("span", "", first ? "Private link, shown once" : "The old link stopped working"));
    form.aside.append(hint);
    if (!guide) {
      form.group("", [copyRow("Address", handed.mcp_url, handed.mcp_url), copyRow("Key", handed.header, handed.header), copyRow("Instructions", "What to save, and when", handed.prompt)]);
      form.body.append(inlineNotice(`This key is shown only once. If it's lost, get a new one from Manage.`));
      form.button("Copy all", "secondary", () => void window.lore.copy(`Address: ${handed.mcp_url}\nKey: ${handed.header}\n\n${handed.prompt}`));
    }
    if (app === "grok" && installed.includes(app)) form.button(`Open ${where}`, "secondary", () => void window.lore.openAgentApp(app).catch((error) => tell(reason(error, `Lore couldn't open ${where}.`))));
    this.wait(handed, who, first);
    form.arm({ primary: "Done" });
    form.focus();
  }

  /** Waits, in the sheet, for the agent's first save to reach Lore, then offers its evening save; after a new link,
   * for the next save, which shows the new link works. The store counts every save, even one that changes nothing,
   * and the key came with the count so far, so only a save made with this key raises it: saves the old key left
   * waiting were already counted. @param {AgentKey} handed @param {string} who @param {boolean} first */
  wait(handed, who, first) {
    const { source, agent } = handed;
    const line = waitLine(who, first);
    this.form.body.append(line);
    const { dialog } = this.form;
    // Asked only while this sheet is on screen.
    const stop = firstSave(handed, () => dialog.open, (saved) => {
      if (first) {
        line.replaceChildren(el("span", "dot ok"), el("span", "", `${who} saved ${plural(saved, "memory")} · `), inline("See them →", () => {
          closeSheet();
          seeFrom({ id: source, label: who });
        }));
      } else line.replaceChildren(el("span", "dot ok"), el("span", "", `${who} saved with the new link`));
      const offer = first && eveningOffer(agent.app, who);
      if (offer) line.after(offer);
    });
    dialog.addEventListener("close", stop);
  }
}

/** What to do in the agent, by its maker's own steps, with its private link or the message around it, and its note;
 * null for an agent with no documented steps. @param {AgentKey} handed @param {boolean} first */
function agentGuide(handed, first) {
  const guide = AGENT_GUIDES[handed.agent.app];
  const how = guide && (first ? guide.first : guide.again);
  if (!guide || !how) return null;
  const list = el("ol", "agent-steps");
  for (const step of how.steps) list.append(el("li", "", step));
  if (how.or) list.lastElementChild?.append(el("span", "agent-step-or", how.or));
  /** @type {HTMLElement[]} */
  const nodes = [list, how.message ? privateLink(handed, how.message, "Copy message") : privateLink(handed)];
  if (guide.note) nodes.push(el("p", "hint", guide.note));
  return nodes;
}

/** The live line while Lore waits on an agent's save. @param {string} who @param {boolean} first */
function waitLine(who, first) {
  const line = el("p", "agent-wait");
  line.append(el("span", "shimmer", `Waiting for ${who}'s ${first ? "first" : "next"} save…`));
  return line;
}

/** Waits, while `active`, for the next save made with this key, and says how many it saved; the waiting is the app's.
 * The store counts every save, even one that changes nothing, and the key came with the count so far, so only a save
 * made with this key raises it: saves the old key left waiting were already counted. Returns what stops it.
 * @param {Pick<AgentKey, "source" | "agent">} handed @param {() => boolean} active @param {(saved: number) => void} heard */
function firstSave({ source, agent }, active, heard) {
  let done = false;
  const check = async () => {
    // Main answers one list at a time.
    if (done || !active()) return;
    const saved = (await window.lore.agents().catch(() => [])).find((entry) => entry.source === source)?.saved ?? 0;
    if (done || saved <= agent.saved) return;
    stop();
    heard(saved - agent.saved);
  };
  const poll = setInterval(() => {
    if (active()) void window.lore.checkAgents().finally(check);
  }, FIRST_SAVE_EVERY_MS);
  /** @param {SourceRead[]} reads */
  const landed = (reads) => {
    if (reads.some((read) => read.name === source)) void check();
  };
  const stop = () => {
    done = true;
    clearInterval(poll);
    agentWaiting.delete(landed);
  };
  agentWaiting.add(landed);
  return stop;
}

/** What one personal agent saved, and what can be done to it. @param {SourceEntry} source */
function openAgent(source) {
  const name = source.label;
  const form = new FormSheet(name, agentMark(source.app, name));
  form.text(agentLine(source));
  form.text(`Lore brings in what ${name} saves while Lore is open. It stays private on this Mac.`, "hint");
  const offer = agents?.find((agent) => agent.source === source.name)?.saved ? eveningOffer(source.app, name) : null;
  if (offer) form.body.append(offer);
  form.button("Disconnect", "quiet", ask);
  form.button("Get a new key", "secondary", rekey);
  form.open();
  function rekey() {
    const confirm = new FormSheet(`Get a new key for ${name}?`, agentMark(source.app, name));
    confirm.text(`The key ${name} has now stops working at once. You give it the new one the same way.`);
    confirm.button("Cancel", "secondary", () => openAgent(source));
    confirm.open({
      primary: "Get a new key",
      working: "Getting a key…",
      failed: "Lore couldn't reach your store. Try again.",
      submit: async () => {
        const handed = await window.lore.agentKey(source.name);
        const setup = new AgentSetup();
        setup.steps(handed, false, await setup.installed);
        setup.form.show();
        return false;
      }
    });
  }
  function ask() {
    const kept = source.imported ? ` The ${plural(source.imported, "memory")} it saved ${source.imported === 1 ? "stays" : "stay"} in your library.` : "";
    const confirm = new FormSheet(`Disconnect ${name}?`, agentMark(source.app, name));
    confirm.text(`${name}'s key stops working, so it can't save to Lore anymore.${kept}`);
    if (source.imported) confirm.button("Delete them too", "quiet", () => void remove(false)).classList.add("destructive");
    confirm.button("Cancel", "secondary", () => openAgent(source));
    confirm.button("Disconnect", "secondary", () => void remove(true));
    confirm.open();
  }
  /** @param {boolean} keep */
  async function remove(keep) {
    await act(async () => {
      const { memories } = await window.lore.disconnectAgent(source.name, keep);
      closeSheet();
      tell(memories.deleted ? `Disconnected ${name}. ${plural(memories.deleted, "memory")} deleted.` : `Disconnected ${name}. ${plural(memories.kept, "memory")} kept.`);
    });
  }
}

/** FAQ: what Lore does, then how the money works, in the order a first-time owner asks. Every
 * answer states the mechanism as it is; no earnings figure the ledger cannot show. @param {Snapshot} s */
function renderFaq(s) {
  const prices = typeof s.pricing.publication_usd === "number" ? `Yours is ${price(s.pricing.publication_usd)} a publication, set on For Sale.` : "You set what a publication costs on For Sale, before your store opens.";
  /** @param {string} question @param {string | HTMLElement} answer */
  const qa = (question, answer) => row(question, answer, undefined, true);
  const buyerGuide = el("span");
  buyerGuide.append("Give your agent the Lore buyer skill. It finds stores, reads their descriptions for free, and buys only within the budget you set. ", /** @type {HTMLElement} */ (outLink("Get the buyer skill ↗", "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy")));
  return [
    section("Getting started", card([
      qa("What is Lore?", "A private place on your Mac for what you've learned from your work. You can sell pieces of it to other people's AI agents, but only the pieces you approve."),
      qa("How do I start?", "Connect an app you already write in, from Connectors, or tell Lore something you learned on Today. Lore drafts things to sell from it, and you approve the ones you like. Approved drafts go on sale in your store."),
      qa("Why connect my apps?", "So you don't start from a blank page. Lore reads what you've already written and suggests what's worth selling."),
      qa("What sells?", "Something specific that happened to you, with the lesson attached: what you tried, what broke, what you'd do again. Dated, firsthand, and not something an AI could guess.")
    ])),
    section("Getting paid", card([
      qa("Who buys?", "AI agents in the middle of a task, and people who find your store page. They read your short descriptions and samples for free, and pay to read the full piece."),
      qa("What does a buyer pay?", `Your price. ${prices}`),
      qa("How do I get paid?", "By card: Stripe pays you out to your bank. Set it up in Settings → Get paid. Agents can also pay a wallet you control directly. Either way, Lore never holds your money."),
      qa("How do buyers find me?", "Once your store is open, list it from Settings. Agents that use the Lore marketplace will see it.")
    ])),
    section("Privacy", card([
      qa("What leaves this Mac?", "Only what you approve for sale, which goes to your store. While drafting, the AI you signed in with reads the memories it's working on, as it would if you used it directly. Nothing else leaves."),
      qa("Can I take something off sale?", "Yes, from For Sale, any time. Anyone who already bought it keeps what they paid for.")
    ])),
    section("If you build agents", card([
      qa("How do I buy?", buyerGuide)
    ]))
  ];
}

/** @param {Snapshot} s */
function renderSettings(s) {
  const live = s.node.live;
  // What Lore has run for the owner (store updates, readings, tasks) is a log, not an automation, so it sits last here.
  const runs = recentRuns(s);
  const path = el("span", "mono path", s.home.replace(/^\/Users\/[^/]+/, "~"));
  path.title = s.home;
  return [
    section("Account", card((auth?.credentials.length ? auth.credentials : [null]).map((credential) => {
      const [name, icon] = credential ? provider(credential) : ["", ""];
      const node = row(credential ? `Signed in with ${name}` : "Not signed in", credential?.type === "api_key" ? "An API key on this Mac reads and writes your memories with you." : "Your subscription reads and writes your memories with you.", credential ? cell(button("Sign out", "quiet", () => signOut(credential.providerId))) : undefined, false);
      if (icon) {
        const img = el("img");
        img.src = icon;
        img.alt = "";
        img.width = 14;
        img.height = 14;
        node.querySelector(".t b")?.prepend(img);
      }
      return node;
    }))),
    section("What Lore keeps", card([
      usageRow(s),
      row("Lore's shape", "What it keeps, what it ignores, what it may sell. Set in a short conversation.", cell(pill(s.setup.blueprint_configured ? "Set" : "Not set", s.setup.blueprint_configured ? "ok" : ""), ...(s.setup.blueprint_configured ? [] : [button("Start", "secondary", startSetup)])), false),
      row("Where it lives", `Your memories are kept on this Mac. ${provider()[0]} reads them when it works with you here. Buyers only ever get what you approve for sale.`, cell(path, button("Show in Finder", "quiet", () => void window.lore.revealHome())), false)
    ])),
    section("Your store", card([
      addressRow(s),
      priceSetting(s),
      getPaidRow(s),
      ...(s.pricing.answer_enabled
        ? [row("Paid answers", "Buyers' agents can ask you a question and pay for each answer.", cell(el("span", "value", `${price(s.pricing.answer_usd)} per answer`)), false)]
        : []),
      // Stores open on real money; only one opened before that sits on the test network.
      ...(live.network === TEST_NETWORK
        ? [row("Test payments", "Your store takes play money while it's on the test network. Switch when you want real buyers paying real money.", cell(pill("Test"), button("Switch to real payments", "secondary", () => void startDeploy(REAL_MONEY))), false)]
        : []),
      ...marketplaceRow(s)
    ])),
    ...(appUpdate ? [section("Updates", card([updateRow(appUpdate)]))] : []),
    ...(runs ? [runs] : [])
  ];
}

/** Settings → Updates: the version on this Mac, and the one thing to do about a newer one. @param {AppUpdate} u */
function updateRow(u) {
  const check = () => void window.lore.checkUpdate();
  const install = () => void window.lore.installUpdate();
  const [detail, ...trailing] = {
    current: ["Lore keeps itself up to date.", pill("Up to date", "ok"), button("Check for updates", "quiet", check)],
    checking: ["Lore keeps itself up to date.", pill("Checking", "wait")],
    downloading: ["A new version is downloading. Lore asks before it restarts.", pill("Downloading", "wait")],
    ready: ["A new version is ready.", button("Restart to update", "primary", install)],
    offline: ["Lore couldn't check for a new version just now. It will try again later.", button("Check again", "secondary", check)],
    outside: ["Move Lore to Applications so it can update itself.", button("Move to Applications", "secondary", install)]
  }[u.state];
  return row(`Lore ${u.version}`, detail, cell(...trailing), false);
}

/** The button at the top of the window, shown only when there is a newer Lore to move to. @param {AppUpdate} next */
function showUpdate(next) {
  appUpdate = next;
  updateBtn.hidden = !(next.state === "ready" || (next.state === "outside" && next.newer));
  updateBtn.title = next.state === "ready" ? "Lore restarts with the new version" : "Move Lore to Applications to update";
  if (view === "settings") render();
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** "6 PM". @param {number} hour */
const clock = (hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

/** When a routine runs, as the owner would say it. @param {RoutineTime} time */
function runsWhen({ cadence, hour, day }) {
  const days = cadence === "weekly" ? DAYS[day] ?? DAYS[0] : cadence === "weekdays" ? "weekday" : "day";
  return `Every ${days} at ${clock(hour)}`;
}

/** Each kind of routine's mark: reading apps, the evening check-in, and the owner's own sentence. */
const ROUTINE_ICONS = {
  read: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"></path><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path></svg>`,
  checkin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"></path></svg>`,
  ask: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1L5 10.5l5.1-1.9z"></path><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"></path></svg>`
};
const CLOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 7.5V12l3 2"></path></svg>`;
const PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"></path></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"></path></svg>`;

/** A small labelled control on a routine. @param {string} label @param {string} icon @param {() => void} onClick @param {string} [text] */
function routineAct(label, icon, onClick, text) {
  const node = el("button", `routine-act${text ? " when-chip" : ""}`);
  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", label);
  node.innerHTML = icon;
  if (text) node.append(text);
  node.addEventListener("click", onClick);
  return node;
}

/** One routine: what it is, when (a chip that changes it), what it last found; Run now, and a switch to pause it. @param {Routine} routine */
function routineRow(routine) {
  const ran = routine.last_run ? `Last ran ${when(routine.last_run)}${routine.result ? ` · ${routine.result}` : ""}` : "Hasn't run yet";
  const status = running.has(routine.id) ? "Running now…" : routine.paused ? "Paused" : `Next ${when(routine.next_run)} · ${ran}`;
  const toggle = el("button", "switch");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(!routine.paused));
  toggle.setAttribute("aria-label", `${routine.paused ? "Resume" : "Pause"} ${routine.name}`);
  toggle.addEventListener("click", () => void changeRoutine(routine, routine.paused ? "resume" : "pause"));
  const detail = el("span", "routine-line");
  detail.append(routineAct("Change time", CLOCK_ICON, () => openRoutineTime(routine), runsWhen({ cadence: routine.cadence, hour: routine.hour, day: routine.day ?? 0 })), " · ", el("span", running.has(routine.id) ? "running" : "", status));
  const trailing = cell(routineAct("Run now", PLAY_ICON, () => void runRoutineNow(routine)));
  if (!routine.built_in) trailing.append(routineAct("Remove", TRASH_ICON, () => void changeRoutine(routine, "remove")));
  trailing.append(toggle);
  const node = row(routine.name, detail, trailing, false);
  const mark = el("span", `routine-mark ${routine.kind}`);
  mark.innerHTML = ROUTINE_ICONS[routine.kind] ?? ROUTINE_ICONS.ask;
  node.prepend(mark);
  node.classList.add("routine");
  if (routine.paused) node.classList.add("paused");
  node.addEventListener("click", (event) => {
    if (!(event.target instanceof Element && event.target.closest("button"))) openRoutine(routine);
  });
  return node;
}

/** One routine, opened: what it does (the owner's own can be reworded), when, and Run now. @param {Routine} routine */
function openRoutine(routine) {
  const own = !routine.built_in;
  const form = new FormSheet(routine.name);
  const title = own ? form.title("Title (optional)") : null;
  if (title) title.value = routine.name === routine.about ? "" : routine.name;
  const text = own ? form.prompt("What Lore does", "Describe what Lore should do.") : null;
  if (text) {
    text.value = routine.about;
    text.maxLength = 500;
  } else {
    form.text(routine.about);
  }
  const before = { cadence: routine.cadence, hour: routine.hour, day: routine.day ?? 0 };
  const chosen = scheduleRows(form, before);
  form.note(ROUTINE_NOTE);
  if (own) form.button("Remove", "quiet", () => { form.close(); void changeRoutine(routine, "remove"); });
  form.button("Run now", "secondary", () => { form.close(); void runRoutineNow(routine); });
  form.open({
    primary: "Save",
    working: "Saving…",
    valid: () => !text || Boolean(text.value.trim()),
    failed: "Lore couldn't save that. Try again.",
    submit: async () => {
      const time = chosen();
      if (text && title && (text.value.trim() !== routine.about || title.value.trim() !== (routine.name === routine.about ? "" : routine.name))) {
        await window.lore.editRoutine(routine.id, text.value, title.value.trim());
      }
      if (time.cadence !== before.cadence || time.hour !== before.hour || (time.cadence === "weekly" && time.day !== before.day)) {
        await window.lore.changeRoutine(routine.id, "time", time);
      }
      await load();
    }
  });
}

/** @param {Routine} routine @param {"pause" | "resume" | "remove" | "time"} action @param {RoutineTime} [time] */
async function changeRoutine(routine, action, time) {
  try {
    await window.lore.changeRoutine(routine.id, action, time);
    if (action === "remove") tell(`Removed “${routine.name}”.`);
  } catch (error) {
    tell(reason(error, "Lore couldn't change that. Try again."), true);
  }
  await load();
}

/** @param {Routine} routine */
async function runRoutineNow(routine) {
  running.add(routine.id);
  render();
  try {
    const done = await window.lore.runRoutine(routine.id);
    tell(`“${done.name}” is done · ${done.result || "Nothing new"}`);
  } catch (error) {
    tell(reason(error, "Lore couldn't run that. Try again."), true);
  } finally {
    running.delete(routine.id);
  }
  await load();
}

/** The Schedule group: Repeat, On (only for a weekly rhythm) and At, filled from `time`. @param {FormSheet} form @param {RoutineTime} time
 * @returns {() => RoutineTime} */
function scheduleRows(form, time) {
  const cadence = form.select("Repeat", [["daily", "Every day"], ["weekdays", "Weekdays"], ["weekly", "Every week"]], time.cadence);
  const day = form.select("On", DAYS.map((name, index) => [String(index), name]), String(time.day));
  const hour = form.select("At", Array.from({ length: 24 }, (_, index) => [String(index), clock(index)]), String(time.hour));
  const showDay = () => { day.row.hidden = cadence.control.value !== "weekly"; };
  cadence.control.addEventListener("change", showDay);
  showDay();
  form.group("Schedule", [cadence.row, day.row, hour.row]);
  return () => ({ cadence: /** @type {Routine["cadence"]} */ (cadence.control.value), hour: Number(hour.control.value), day: Number(day.control.value) });
}

const ROUTINE_NOTE = "Runs on this Mac while Lore is open. What it finds stays private.";

/** @param {Routine} routine */
function openRoutineTime(routine) {
  const form = new FormSheet("Change time");
  form.text(routine.name);
  const chosen = scheduleRows(form, { cadence: routine.cadence, hour: routine.hour, day: routine.day ?? 0 });
  form.button("Cancel", "secondary", () => form.close());
  form.open({ primary: "Save", submit: () => void changeRoutine(routine, "time", chosen()) });
}

/** A plain sentence and a time: Lore runs it on its own agent, under the rules its own reading keeps. */
function openNewRoutine() {
  const form = new FormSheet("New automation");
  const name = form.title("Title (optional)");
  const text = form.prompt("Describe what Lore should do", "Describe what Lore should do.\nFor example: every Sunday, remember what I read this week.");
  text.maxLength = 500;
  const chosen = scheduleRows(form, { cadence: "weekly", hour: 18, day: 6 });
  form.note(ROUTINE_NOTE);
  form.button("Cancel", "secondary", () => form.close());
  form.open({
    primary: "Create",
    valid: () => Boolean(text.value.trim()),
    failed: "Lore couldn't add that. Try again.",
    submit: async () => {
      await window.lore.addRoutine(text.value, chosen(), name.value.trim());
      await load();
    }
  });
  text.focus();
}

/** APP-200: everything Lore does on its own, and when: Lore's and the owner's alike, in one list, then what ran lately. @param {Snapshot} s */
function renderAutomations(s) {
  const add = row("New automation", "Tell Lore what to do and when, in a sentence.", undefined, false);
  const plus = el("span", "routine-mark add");
  plus.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>`;
  add.prepend(plus);
  add.classList.add("routine", "add-tile");
  add.tabIndex = 0;
  add.setAttribute("role", "button");
  add.addEventListener("click", openNewRoutine);
  add.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openNewRoutine(); } });
  const list = el("div", "routines");
  list.append(...[...routines].sort((x, y) => Number(Boolean(y.built_in)) - Number(Boolean(x.built_in))).map(routineRow), add);
  return [list];
}

const renderers = { today: renderToday, inventory: renderInventory, connectors: renderConnectors, automations: renderAutomations, faq: renderFaq, settings: renderSettings };

function render() {
  hidePeek();
  renderNotices();
  const detail = view === "today" ? detailTask : null;
  const welcoming = view === "today" && !detail && firstRun.active;
  const heading = detail ? detailRecord?.title ?? TASK_TITLES[detail] : welcoming ? "Welcome to Lore" : { today: greeting(), inventory: "Inventory", connectors: "Connectors", automations: "Automations", faq: "FAQ", settings: "Settings" }[view];
  const pendingDrafts = detail === "publish" && (candidates.length || extraDrafts.length);
  eyebrow.textContent = detail
    ? pendingDrafts ? `Needs you · ${draftsPhase()}` : `${TASK_STATES[detailRecord?.state ?? "working"]} · ${detailRecord?.phase ?? "Starting"}`
    : welcoming ? "" : view === "today" ? longDate.format(new Date()) : "";
  title.textContent = heading;
  taskBack.hidden = !detail;
  taskRestart.hidden = !detail || detailRecord?.state !== "stopped";
  addMemoryBtn.hidden = Boolean(detail) || view !== "inventory";
  sellWritingBtn.hidden = addMemoryBtn.hidden;
  captureArea.hidden = view !== "today" || welcoming;
  skipBtn.hidden = !welcoming;
  header.classList.toggle("compact", welcoming || Boolean(detail));
  mainEl.classList.toggle("thread", Boolean(detail));
  log.hidden = !detail;
  syncComposer();
  for (const nav of navButtons) nav.setAttribute("aria-pressed", String(nav.dataset.view === view));
  if (!snapshot) return;
  $("[data-count=inventory]").textContent = String(snapshot.library.counts.private + snapshot.publications.counts.active);
  $("[data-count=connectors]").textContent = String(snapshot.library.sources.filter((source) => source.enabled).length);
  // Hidden until a build has a feedback relay to send to, so a release
  // never offers a Send it cannot honor. Starts hidden in index.html.
  feedbackBtn.hidden = !snapshot.feedback?.available;
  const parts = renderers[view](snapshot);
  detailSlot.replaceChildren(...(detail ? parts : []));
  content.replaceChildren(...(detail ? [] : parts));
  for (const area of mainEl.querySelectorAll("textarea")) fit(/** @type {HTMLTextAreaElement} */ (area));
  renderAccount();
}

/** The account row at the foot of the sidebar: who is signed in, and the menu that holds Settings, help and feedback. */
function renderAccount() {
  const credential = auth?.credentials[0];
  const [name, icon] = provider(credential);
  const avatar = el("span", "avatar");
  if (icon) avatar.append(Object.assign(el("img"), { src: icon, alt: "" }));
  const who = el("span", "who");
  const store = snapshot?.node.url ? ` · ${nodeLabel(snapshot.node)}` : "";
  who.append(el("b", "", credential ? "Signed in" : "Not signed in"), el("span", "", credential ? `${name}${store}` : ""));
  account.replaceChildren(avatar, who);
  account.insertAdjacentHTML("beforeend", CHEVRON);
  accountLine.textContent = credential ? `Signed in with ${name}` : "Not signed in";
  signOutBtn.hidden = !credential;
  signOutBtn.textContent = `Sign out of ${name}`;
}

/** Memories and For Sale became Inventory's tabs; anything that still asks for them lands there. @param {View | "memories" | "store"} next */
function show(next) {
  if (next === "memories" || next === "store") shelf = next === "store" ? "sale" : "private";
  view = next === "memories" || next === "store" ? "inventory" : next;
  if (view === "inventory") void loadSales();
  if (next === "connectors") void loadAgents();
  // A store update said once, where it happened; it doesn't follow the owner around.
  pushedNote = false;
  unseen.visit();
  render();
  mainEl.scrollTop = 0;
  mainEl.focus({ preventScroll: true });
}

/** Every "change the price" affordance lands on For Sale, with the one price sheet open over it. */
function openPriceEditor() {
  detailTask = null;
  detailRecord = null;
  show("store");
  openPriceSheet();
}

async function load() {
  if (!snapshot) content.replaceChildren(el("p", "hint", "Loading…"));
  // Loads overlap (a "changed" then a "ready" a moment later); one that started earlier but finished later is stale.
  const ticket = ++loads;
  try {
    const loaded = await Promise.all([window.lore.snapshot(), window.lore.candidates().catch(() => []), window.lore.extras().catch(() => []), window.lore.tasks().catch(() => []), apps.length ? apps : window.lore.sourceCatalog().catch(() => []), window.lore.readyRuns().catch(() => readyRuns), window.lore.checkIn().catch(() => null), window.lore.routines().catch(() => routines)]);
    if (ticket !== loads) return;
    [snapshot, candidates, extraDrafts, taskItems, apps, readyRuns, checkIn, routines] = loaded;
    let newest = 0;
    for (const item of snapshot.library.items) newest = Math.max(newest, item.arrival);
    await unseen.load(newest).catch(() => undefined);
    if (ticket !== loads) return;
    if (detailTask) detailRecord = taskItems.find((item) => item.kind === detailTask) ?? detailRecord;
    peeked.clear();
    firstRun.consider(snapshot);
    noticeAutomations();
    noticeUsage();
    // A dismissed notice whose write failed was still seen: try it again, without showing it again.
    if (!appShell.hidden) for (const key of told.keys()) if (!notices.some((item) => item.key === key)) remember(key);
    render();
    // Today's earnings need the ledger once; after that a new sale or For Sale reads it again.
    if (!salesAsked && snapshot.node.url) void loadSales();
    if (agentAfterStore && snapshot.node.url && !taskItems.some((item) => item.kind === "deploy" && item.state === "working")) {
      agentAfterStore = false;
      // Back where the owner started, with the sheet at its next step.
      if (detailTask === "deploy") closeTask();
      show("connectors");
      new AgentSetup().open();
    }
  } catch {
    if (ticket !== loads) return;
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

/** @typedef {{label: string, run: () => void}} NoticeAction */
/** A Today notice carries its `key`; it leaves only by its × or its own action.
 * @type {Array<{text: string, attention: boolean, action?: NoticeAction, key?: string}>} */
const notices = [];

/** Something Lore did or could not do, said where the owner is: in the open thread, or as a notice above the page when the log is hidden, scrolled into view. A newer success replaces an older one; one told once stays until dismissed. @param {string} text @param {boolean} [attention] @param {NoticeAction} [action] The one next step, on the notice. */
function tell(text, attention = false, action) {
  if (!log.hidden) { say(text, false, attention); return; }
  if (!attention) drop((item) => !item.attention && !item.key);
  notices.push({ text, attention, action });
  const plain = notices.filter((item) => !item.key);
  if (plain.length > 3) notices.splice(notices.indexOf(plain[0]), 1);
  renderNotices();
  status.scrollIntoView({ block: "nearest" });
}

/** Today notices told this sign-in, by key, and the write that remembers each as said, kept until it lands.
 * @type {Map<string, {write: () => Promise<unknown>, pending: boolean} | null>} */
const told = new Map();
/** Seen notices are remembered one write at a time: each goes through the CLI, and two first writes at once can collide. */
let remembering = /** @type {Promise<unknown>} */ (Promise.resolve());

/** A notice for Today only, told at most once a sign-in. @param {string} key @param {string} text @param {NoticeAction} action @param {() => Promise<unknown>} write */
function tellOnce(key, text, action, write) {
  if (told.has(key)) return;
  told.set(key, { write, pending: false });
  notices.push({ text, attention: false, action, key });
  renderNotices();
}

/** Today is what the owner sees: signed in, on Today, with no thread open over it. */
function onToday() {
  return !appShell.hidden && view === "today" && !detailTask && !firstRun.active;
}

/** Remember a seen Today notice as said; a failed write stays to be tried again. A write that comes up after a sign-out,
 * or for a notice told again since, is skipped. @param {string} key */
function remember(key) {
  const entry = told.get(key);
  if (!entry || entry.pending) return;
  entry.pending = true;
  const current = () => told.get(key) === entry && !appShell.hidden;
  remembering = remembering
    .then(() => (current() ? entry.write().then(() => { if (current()) told.set(key, null); }) : undefined))
    .catch(() => { entry.pending = false; });
}

/** @param {(item: typeof notices[number]) => boolean} which */
function drop(which) {
  notices.splice(0, notices.length, ...notices.filter((item) => !which(item)));
  renderNotices();
}

function renderNotices() {
  const shown = notices.filter((item) => !item.key || onToday());
  status.replaceChildren(...shown.map((item) => {
    const box = el("div", item.attention ? "notice attention" : "notice info");
    box.setAttribute("role", item.attention ? "alert" : "status");
    box.insertAdjacentHTML("afterbegin", item.attention ? ALERT_ICON : INFO_ICON);
    const dismiss = el("button", "dismiss", "×");
    dismiss.type = "button";
    dismiss.setAttribute("aria-label", "Dismiss");
    const drop = () => { notices.splice(notices.indexOf(item), 1); renderNotices(); };
    dismiss.addEventListener("click", drop);
    box.append(el("span", "", item.text));
    if (item.action) box.append(button(item.action.label, "quiet", () => { drop(); item.action?.run(); }));
    box.append(dismiss);
    return box;
  }));
  // A Today notice is in `shown` only while Today is on screen, so it is remembered only once the owner can see it.
  for (const item of shown) if (item.key) remember(item.key);
}

/** @param {string} text @param {boolean} [status] */
function live(text, status = false) {
  if (status) liveStatus = text;
  else liveText = text;
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
  waitingTask = !shown && request?.task && request.task !== detailTask ? request.task : null;
  waiting.hidden = !waitingTask;
  if (waitingTask) waitingText.textContent = `Lore is waiting on you in ${TASK_TITLES[waitingTask]}.`;
  requestSlot.hidden = !shown;
  composer.hidden = Boolean(waitingTask) || (shown !== null && !card) || ((detailTask === "setup" || detailTask === "deploy") && detailRecord?.state === "done");
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
  resetBlueprintGhost();
  syncComposer();
}

/** What Lore is doing while its turn is open, in one shimmering line. @param {string} label */
function thinkingLine(label) {
  const line = el("div", "line live thinking");
  line.setAttribute("role", "status");
  line.append(el("span", "shimmer", label));
  return line;
}

/** Each kind of step by its icon and its words, for `n` steps of that kind in a row. */
const STEP_WORDS = /** @type {Record<StepKind, [string, (n: number) => string]>} */ ({
  read: ["memory", (n) => `Read ${plural(n, "note")}`],
  "read-memory": ["memory", (n) => `Read ${plural(n, "memory")}`],
  write: ["edit", (n) => `Wrote ${plural(n, "note")}`],
  "write-memory": ["edit", (n) => `Wrote ${plural(n, "memory")}`],
  edit: ["edit", (n) => `Edited ${plural(n, "note")}`],
  "edit-memory": ["edit", (n) => `Edited ${plural(n, "memory")}`],
  look: ["look", () => "Looked through your Lore"],
  draft: ["publish", (n) => `Drafted ${plural(n, "piece")}`],
  extras: ["publish", () => "Drafted free parts"],
  listing: ["publish", () => "Changed what's for sale"],
  push: ["update", () => "Updated your store"],
  deploy: ["store", () => "Set up your store"],
  sales: ["store", () => "Checked your sales"],
  status: ["store", () => "Checked your store"],
  price: ["publish", () => "Set your price"],
  profile: ["check", () => "Saved your profile"],
  shape: ["check", () => "Saved how your Lore is shaped"],
  capture: ["memory", () => "Saved memories"],
  answers: ["store", () => "Changed paid answers"],
  "open-store": ["store", () => "Opened your store"],
  open: ["update", () => "Opened a page"],
  work: ["work", () => "Worked on your Lore"]
});
const STEP_MARKS = {
  ...STEP_ICONS,
  edit: lineIcon(`<path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"></path>`),
  look: lineIcon(`<circle cx="11" cy="11" r="6.5"></circle><path d="M20 20l-4-4"></path>`),
  check: lineIcon(`<path d="M5 12.5l4.5 4.5L19 7.5"></path>`),
  work: lineIcon(`<circle cx="12" cy="12" r="3"></circle>`)
};

/** How long something took, as a step row says it: "0.4s", "12s", "1m 05s". @param {number} ms */
function took(ms) {
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** One row per run of steps of the same kind. @param {Step[]} steps */
function stepRows(steps) {
  /** @type {Step[][]} */
  const runs = [];
  for (const step of steps) {
    const last = runs.at(-1);
    if (last && last[0].kind === step.kind) last.push(step);
    else runs.push([step]);
  }
  return runs.map((run) => {
    const [icon, words] = STEP_WORDS[run[0].kind];
    const running = run.some((step) => step.ended === undefined);
    const node = el("div", "step");
    node.insertAdjacentHTML("afterbegin", STEP_MARKS[/** @type {keyof typeof STEP_MARKS} */ (icon)]);
    node.append(el("span", running ? "shimmer" : "", words(run.length)));
    if (!running) node.append(el("span", "took", took(run.reduce((sum, step) => sum + (step.ended ?? step.started) - step.started, 0))));
    return node;
  });
}

/** A turn's steps: each as a row while Lore is on them, then folded into one line that opens on click.
 * @param {Line & { steps: Step[] }} entry @param {boolean} active */
function stepsLine(entry, active) {
  const line = el("div", "line steps");
  const list = el("div", "steps-list");
  list.append(...stepRows(entry.steps));
  if (active) {
    line.append(list);
    return line;
  }
  const ended = Math.max(...entry.steps.map((step) => step.ended ?? step.started));
  const summary = el("button", "steps-sum");
  summary.type = "button";
  summary.insertAdjacentHTML("beforeend", lineIcon(`<path d="M9 6l6 6-6 6"></path>`));
  summary.append(el("span", "", `${plural(entry.steps.length, "step")} · ${took(ended - entry.steps[0].started)}`));
  const fold = el("div", "steps-fold");
  fold.append(list);
  const show = () => {
    line.classList.toggle("open", Boolean(entry.open));
    summary.setAttribute("aria-expanded", String(Boolean(entry.open)));
  };
  summary.addEventListener("click", () => { entry.open = !entry.open; show(); });
  show();
  line.append(summary, fold);
  return line;
}

/** A tool call starting or ending in the open thread. @param {Extract<AgentEvent, { type: "step" }>} event */
function step(event) {
  const last = lines.at(-1);
  if (event.done) {
    const found = last?.steps?.find((each) => each.id === event.id);
    if (!found) return;
    found.ended = Date.now();
  } else if (event.kind) {
    const started = { id: event.id, kind: event.kind, started: Date.now() };
    if (last?.steps) last.steps.push(started);
    else lines.push({ text: "", owner: false, steps: [started] });
  }
  renderLog();
}

/** When each word of the streaming reply first showed, by its place in the reply. @type {number[]} */
const inkTimes = [];
const INK_MS = 150;

/** The streaming reply with only its newest words inking in; a word already in keeps going where it was, and code
 * never animates. @param {HTMLElement} node */
function inked(node) {
  const now = performance.now();
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, { acceptNode: (text) => text.parentElement?.closest("pre, code") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  /** @type {Text[]} */
  const texts = [];
  for (let text = walk.nextNode(); text; text = walk.nextNode()) texts.push(/** @type {Text} */ (text));
  let index = 0;
  for (const text of texts) {
    const pieces = (text.textContent ?? "").split(/(\s+)/).map((part) => {
      if (!part.trim()) return part;
      const since = now - (inkTimes[index] ??= now);
      index++;
      if (since >= INK_MS) return part;
      const word = el("span", "ink", part);
      word.style.animationDelay = `${-since}ms`;
      return word;
    });
    if (pieces.some((piece) => typeof piece !== "string")) text.replaceWith(...pieces);
  }
  return node;
}

/** APP-218: the open thread's lines, each coming in once. Streamed text keeps the key of the line it becomes. */
const logEntrance = new Entrance();

function renderLog() {
  const thread = detailTask ?? "today";
  const working = busy !== null && !liveText;
  log.replaceChildren(...lines.map((entry, index) => {
    const { text, owner, stopped, saved, steps } = entry;
    if (steps) {
      const line = stepsLine(/** @type {Line & { steps: Step[] }} */ (entry), working && index === lines.length - 1);
      line.dataset.say = `${thread} ${index}`;
      return line;
    }
    const line = el("div", owner ? "line owner" : stopped ? "line stop" : "line");
    line.dataset.say = `${thread} ${index}`;
    line.append(speaker(owner), saved ? savedCard(saved) : owner ? el("p", "", text) : markdown(text));
    return line;
  }));
  if (liveText) {
    const line = el("div", "line live");
    line.dataset.say = `${thread} ${lines.length}`;
    line.append(speaker(false), inked(markdown(liveText)));
    log.append(line);
  } else inkTimes.length = 0;
  const stepping = Boolean(working && lines.at(-1)?.steps?.some((each) => each.ended === undefined));
  const thinking = busy !== null && !request;
  if (thinking && busy && !stepping) {
    const line = thinkingLine(liveStatus || THINKING[busy] || "");
    line.dataset.say = `${thread} thinking ${lines.length}`;
    log.append(line);
  }
  logEntrance.play(/** @type {HTMLElement[]} */ ([...log.children]));
  agentPanel.hidden = !lines.length && !liveText && !thinking && !shownRequest() && !detailSlot.childElementCount && !blueprintGhost;
  if (log.lastElementChild) reveal();
}

/** Show the newest thing: a pinned card just below the sticky header, otherwise the end of the thread. */
function reveal() {
  const box = shownRequest()?.pinned ? request?.box : null;
  mainEl.scrollTop = box ? Math.max(0, box.getBoundingClientRect().top - mainEl.getBoundingClientRect().top + mainEl.scrollTop - header.offsetHeight - 16) : mainEl.scrollHeight;
}

/** Ghost-mode field order: key, label, and how to read that field's display text out of a (possibly partial) fields object. */
const BLUEPRINT_GHOST_ROWS = /** @type {const} */ ([
  ["name", "Name", (/** @type {Partial<BlueprintFields>} */ f) => f.name ?? ""],
  ["persona", "Told as", (/** @type {Partial<BlueprintFields>} */ f) => f.persona ?? ""],
  ["organizing_axis", "Organized by", (/** @type {Partial<BlueprintFields>} */ f) => f.organizing_axis ?? ""],
  ["topic_outline", "Topics", (/** @type {Partial<BlueprintFields>} */ f) => (f.topic_outline ?? []).join(", ")],
  ["focus_topics", "In depth", (/** @type {Partial<BlueprintFields>} */ f) => (f.focus_topics ?? []).join(", ")],
  ["general_areas", "Lightly", (/** @type {Partial<BlueprintFields>} */ f) => (f.general_areas ?? []).join(", ")],
  ["storytelling", "Voice", (/** @type {Partial<BlueprintFields>} */ f) => f.storytelling ?? ""]
]);

/**
 * The blueprint panel: a read-only ghost while fields are still streaming in
 * from propose_blueprint, or the editable confirm form once it settles.
 * Reuses `blueprintGhost` as the same node across both modes (APP-022) —
 * nothing is thrown away and rebuilt when the mode switches, only its
 * contents change. In "live" mode the field rows are built once and then only
 * patched in place, so a field's settle transition plays exactly once no
 * matter how many more deltas stream in afterward, for it or any other field.
 * @param {Partial<BlueprintFields> & { evidence?: string }} fields
 * @param {"live" | "confirm"} mode
 */
function blueprintPanel(fields, mode) {
  const reused = Boolean(blueprintGhost);
  const box = /** @type {HTMLFormElement} */ (blueprintGhost ?? el("form", "card lead request blueprint-panel"));
  blueprintGhost = box;
  box.classList.toggle("ghost", mode === "live");
  /** @type {Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>} */
  const controls = {};
  if (mode === "live") {
    if (!reused) {
      box.replaceChildren(el("p", "q", "Shaping your Lore…"), el("p", "hint"));
      const inputs = el("div", "blueprint-fields");
      blueprintFieldValues = {};
      for (const [key, label] of BLUEPRINT_GHOST_ROWS) {
        const field = el("label", "pending");
        const value = el("span", "value", "…");
        field.append(el("span", "", label), value);
        inputs.append(field);
        blueprintFieldValues[key] = value;
      }
      box.append(inputs);
    }
    const hint = /** @type {HTMLElement} */ (box.querySelector(".hint"));
    hint.textContent = fields.evidence ?? "";
    hint.hidden = !fields.evidence;
    for (const [key, , read] of BLUEPRINT_GHOST_ROWS) {
      const text = read(fields);
      const valueEl = blueprintFieldValues?.[key];
      if (!text || !valueEl) continue;
      valueEl.textContent = text;
      const field = valueEl.parentElement;
      if (field?.classList.contains("pending")) field.classList.replace("pending", "settled");
    }
    return { box, controls };
  }
  box.replaceChildren();
  box.append(el("p", "q", "Use this shape for your Lore?"));
  if (fields.evidence) box.append(el("p", "hint", fields.evidence));
  const inputs = el("div", "blueprint-fields");
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
  add("name", "Name", fields.name ?? "", false);
  for (const [key, label] of [["persona", "Told as"], ["organizing_axis", "Organized by"]]) {
    const field = el("label");
    field.append(el("span", "", label));
    const select = el("select");
    const choices = key === "persona" ? ["storyteller", "schoolteacher", "professor", "executive", "sage"] : ["", "chronological", "theme", "project", "knowledge"];
    for (const choice of choices) {
      const option = el("option", "", choice || "persona default");
      option.value = choice;
      option.selected = choice === (/** @type {Record<string, unknown>} */ (fields)[key] ?? "");
      select.append(option);
    }
    field.append(select);
    controls[key] = select;
    inputs.append(field);
  }
  add("topic_outline", "Topics", (fields.topic_outline ?? []).join(", "));
  add("focus_topics", "In depth", (fields.focus_topics ?? []).join(", "));
  add("general_areas", "Lightly", (fields.general_areas ?? []).join(", "));
  add("storytelling", "Voice", fields.storytelling ?? "");
  box.append(inputs);
  const actions = el("div", "actions");
  const use = el("button", "btn primary sm", "Use this shape");
  use.type = "submit";
  actions.append(use);
  box.append(actions);
  return { box, controls };
}

const PAYOUT_PATHS = [
  {
    label: "My Coinbase account",
    detail: "Payments can go on to your bank from there.",
    steps: ["In the Coinbase app, tap Receive, then USDC.", "Set the network to Base. Not Ethereum or Solana.", "Copy the address and paste it here."],
    help: outLink("No account yet? Create one ↗", "https://www.coinbase.com/signup")
  },
  {
    label: "A wallet app",
    detail: "MetaMask, Rainbow, Coinbase Wallet, or similar.",
    steps: ["Open your wallet and tap Receive.", "Pick the Base network.", "Copy the address and paste it here."],
    help: null
  }
];
const PUBLIC_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The one step where new sellers stalled: two paths, their exact taps, and a field that says what it got. @param {OwnerQuestion} question @param {number} index */
function payoutField(question, index) {
  const fieldset = el("fieldset", "payout");
  fieldset.dataset.question = question.question;
  fieldset.append(el("legend", "q", question.question), el("p", "hint", "Each payment goes straight there. Lore never holds your money."));
  const choices = el("div", "choices");
  const steps = el("div", "payout-steps");
  const pick = (/** @type {typeof PAYOUT_PATHS[number]} */ path) => {
    const list = el("ol");
    list.append(...path.steps.map((step) => el("li", "", step)));
    steps.replaceChildren(list, ...(path.help ? [path.help] : []));
  };
  for (const [position, path] of PAYOUT_PATHS.entries()) {
    const label = el("label", "choice");
    const radio = el("input");
    radio.type = "radio";
    radio.name = `question-${index}`;
    radio.value = path.label;
    radio.checked = position === 0;
    radio.addEventListener("change", () => pick(path));
    label.append(radio, el("span", "", path.label));
    if (position === 0) label.append(chip("Recommended"));
    label.append(el("small", "", path.detail));
    choices.append(label);
  }
  pick(PAYOUT_PATHS[0]);
  const address = el("input", "other-answer mono");
  address.type = "text";
  address.required = true;
  address.pattern = PUBLIC_ADDRESS.source.slice(1, -1);
  address.placeholder = "0x…";
  address.spellcheck = false;
  address.autocomplete = "off";
  const status = el("p", "hint payout-status");
  address.addEventListener("input", () => {
    const value = address.value.trim();
    // A recovery phrase is the wallet itself; it must not sit in a field, a transcript, or a memory.
    if (value.split(/\s+/).length >= 12) {
      address.value = "";
      status.textContent = "That looks like a recovery phrase. Never share it with anyone, Lore included. Paste the address that starts with 0x.";
      status.dataset.state = "warn";
    } else if (PUBLIC_ADDRESS.test(value)) {
      address.value = value;
      status.textContent = `✓ Payments will land at ${value.slice(0, 6)}…${value.slice(-4)}.`;
      status.dataset.state = "ok";
    } else {
      status.textContent = value ? "Not an address yet. It starts with 0x and is 42 characters long." : "";
      status.dataset.state = "";
    }
  });
  fieldset.append(choices, steps, address, status);
  return fieldset;
}

/** @param {AgentRequest} event */
function renderRequest(event) {
  // The blueprint panel is built by the shared blueprintPanel() below, in confirm
  // mode, reusing the live ghost node if the evidence scan already built one.
  const blueprint = event.type === "blueprint" ? blueprintPanel({ ...event.fields, evidence: event.evidence }, "confirm") : null;
  const box = /** @type {HTMLFormElement} */ (blueprint?.box ?? el("form", "card lead request"));
  /** A memory card's entries as edited. @type {(() => ProposedMemory[]) | undefined} */
  let current;
  if (event.type === "question") {
    for (const [index, question] of event.questions.entries()) {
      if (question.format === "evm_address") {
        box.append(payoutField(question, index));
        continue;
      }
      const fieldset = el("fieldset");
      fieldset.dataset.question = question.question;
      fieldset.append(el("legend", "q", question.question));
      if (event.source === "app" && question.detail) fieldset.append(el("div", "detail", question.detail));
      const choices = el("div", "choices");
      for (const option of question.options) {
        const label = el("label", "choice");
        const pick = el("input");
        pick.type = question.multiSelect ? "checkbox" : "radio";
        pick.name = `question-${index}`;
        pick.value = option.label;
        const recommended = !question.multiSelect && option.recommended === true;
        pick.checked = recommended;
        label.append(pick, el("span", "", option.label));
        if (recommended) label.append(chip("Recommended"));
        if (option.description) label.append(el("small", "", option.description));
        choices.append(label);
      }
      fieldset.append(choices);
      const other = el("input", "other-answer");
      other.type = "text";
      other.placeholder = question.options.length ? "Or type your answer" : "Type your answer";
      fieldset.append(other);
      box.append(fieldset);
    }
    const actions = el("div", "actions");
    const go = el("button", "btn primary sm", event.questions.every((question) => question.format === "evm_address") ? "Use this address" : "Continue");
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
      respond(event.id, answers, Object.values(answers).filter(Boolean).map(brief).join(" · "));
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
      title.maxLength = 200;
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
    const { controls } = /** @type {NonNullable<typeof blueprint>} */ (blueprint);
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
  } else if (event.type === "open") {
    // Two stages on one card: open the page, then say how it went.
    const host = new URL(event.url).hostname;
    const heading = el("p", "q", event.title);
    const note = markdown(event.note);
    note.classList.add("hint");
    box.append(heading, note);
    const actions = el("div", "actions");
    const decline = el("button", "btn secondary sm", "Not now");
    decline.type = "button";
    const go = el("button", "btn primary sm", `Open ${host}`);
    go.type = "submit";
    actions.append(decline, go);
    box.append(actions);
    let opened = false;
    decline.addEventListener("click", () => respond(event.id, opened ? "stuck" : false, opened ? "I need help" : "Not now"));
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      if (opened) { void respond(event.id, "done", "Done"); return; }
      opened = true;
      window.open(event.url);
      decline.textContent = "I need help";
      go.textContent = "Done";
    });
  } else if (event.type === "price") {
    box.append(el("p", "q", "What should a buyer pay per publication?"), el("p", "hint", event.reason));
    const [field, amount] = priceField(String(event.amount));
    const actions = el("div", "actions");
    const later = el("button", "btn secondary sm", "Not now");
    later.type = "button";
    later.addEventListener("click", () => respond(event.id, null, "Not now"));
    const set = el("button", "btn primary sm", "Set price");
    set.type = "submit";
    actions.append(later, set);
    box.append(field, actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      // The agent only ever learns the number on this card, never its own.
      const value = parsePrice(amount.value);
      if (value === null) {
        tell(`${ABOVE_ZERO}.`, true);
        return;
      }
      respond(event.id, value, price(value));
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
    if (event.prompt.type === "secret") actions.append(button("Not now", "secondary", () => void respond(event.id, "")));
    actions.append(go);
    box.append(field, actions);
    box.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const value = field.value;
      field.value = "";
      respond(event.id, value);
    });
  }
  const pinned = event.type === "question" || event.type === "memories" || event.type === "blueprint";
  request = { id: event.id, task: event.task, box, pinned, current };
  liveText = liveStatus = "";
  renderLog();
  requestSlot.replaceChildren(box);
  agentPanel.hidden = false;
  syncComposer();
  if (view !== "today") show("today");
  for (const area of box.querySelectorAll("textarea")) fit(/** @type {HTMLTextAreaElement} */ (area));
  reveal();
  if (!pinned) /** @type {HTMLElement | null} */ (box.querySelector("input[type=text], input[type=password], select"))?.focus({ preventScroll: true });
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
  await send(SETUP_INTENT);
}

/** @param {string} [intent] */
async function startDeploy(intent = STORE_INTENT) {
  await openTask("deploy");
  await send(intent);
}


/** What the owner just made, in their terms: what is on sale, for how much, and where the money lands. @param {Snapshot} s */
function storeOpened(s) {
  const count = s.publications.counts.active;
  const each = typeof s.pricing.publication_usd === "number" ? ` at ${price(s.pricing.publication_usd)} each` : "";
  const onSale = `${count === 1 ? "Your approved piece is" : `All ${count} approved pieces are`} on sale${each}.`;
  const payout = s.node.live.payout;
  return payout ? `${onSale} Every payment lands at ${payout.slice(0, 6)}…${payout.slice(-4)}, and nowhere else.` : onSale;
}

/** @param {Snapshot} s */
function nextRung(s) {
  const box = el("div", "card lead request");
  const deploy = detailTask === "deploy";
  const storeOpen = forSale(s);
  // Online only so the owner's agents can save to it: nothing is on sale, and selling is its own step later.
  const forAgents = Boolean(s.node.url) && !storeOpen;
  const heading = deploy ? (storeOpen ? "Your store is open." : forAgents ? "Your store is online for your agents." : "Your store isn't open yet.") : "Your Lore is set up.";
  const detail = deploy
    ? storeOpen
      ? storeOpened(s)
      : forAgents
        ? "Nothing is for sale. When you approve something to sell, Lore asks for a price and where payments go."
        : "This step is done. Try again now, or any time from Today."
    : "This step is done. What comes next is a separate step — take it now, or any time from Today.";
  box.append(
    el("p", "q", heading),
    el("p", "hint", detail)
  );
  const actions = el("div", "actions");
  if (storeOpen && s.node.url) {
    const live = el("a", "btn secondary sm", "Your store ↗");
    live.href = s.node.url.replace(/\/mcp$/, "");
    live.target = "_blank";
    live.rel = "noreferrer";
    actions.append(live);
  } else if (!forAgents) {
    // Online for the owner's agents, selling waits for an approved piece: drafting one is the next step.
    actions.append(button("Open your store", "secondary", () => void startDeploy()));
  }
  actions.append(button("Publish something", "primary", () => void startPublish()));
  box.append(actions);
  return box;
}

/** @param {SourceEntry} [source] A connected app to draft from. */
async function startPublish(source) {
  await openTask("publish");
  if (busy === "publish") return;
  await send(source ? `Help me publish something from what Lore brought in from ${source.label}.` : "Help me publish something from my Lore.", undefined, undefined, source?.name);
}

/** The step after bringing an app's writing in. @param {SourceEntry} source */
function sellAction(source) {
  return {
    label: "Turn these into something to sell",
    run: () => {
      closeSheet();
      drop((item) => Boolean(item.action) && !item.key);
      void startPublish(source);
    }
  };
}

/** @param {AgentTask} kind @param {TaskRecord} [record] @param {TaskRecord} [fallback] Used only when neither `record` nor a live entry in `taskItems` exists, so the header reflects the caller's best-known status instead of fabricating "Working". */
async function openTask(kind, record, fallback) {
  pushedNote = false;
  task = kind;
  detailTask = kind;
  detailRecord = record ?? taskItems.find((item) => item.kind === kind) ?? fallback ?? null;
  // Read regardless of whether a live TaskRecord exists: a Recent-runs row can open
  // a thread that already finished (and so dropped out of taskItems), and history()
  // reads the session file directly, returning [] when there is truly nothing there.
  lines.splice(0, lines.length, ...(await window.lore.history(kind).catch(() => [])));
  liveText = liveStatus = "";
  resetBlueprintGhost();
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
  liveText = liveStatus = "";
  clearRequest();
  show("today");
  renderLog();
  // Setup and the store are Lore's flows to begin; a capture or publish thread waits for the owner's first word.
  const opening = kind === "setup" ? SETUP_INTENT : kind === "deploy" ? STORE_INTENT : null;
  if (opening) await send(opening);
  else input.focus({ preventScroll: true });
}

function closeTask() {
  detailTask = null;
  detailRecord = null;
  task = "capture";
  lines.splice(0);
  liveText = liveStatus = "";
  resetBlueprintGhost();
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
/** Each update card's decision, with whatever the owner edited, for Approve all. @type {WeakMap<HTMLElement, () => {original: PublicationExtras, extras: PublicationExtras}>} */
const extrasApprovals = new WeakMap();
let confirmingExtras = false;
/** How many pieces Approve all is saving and pushing; zero when it isn't. */
let approvingExtras = 0;

function approvals() {
  const list = el("div", "card pad stack");
  const shown = new Set();
  /** @param {PublicationCandidate | ExtrasCandidate} draft */
  const form = (draft) => {
    const key = JSON.stringify(draft);
    shown.add(key);
    const node = approvalForms.get(key) ?? ("extras" in draft ? extrasForm(draft) : approvalForm(draft));
    approvalForms.set(key, node);
    return node;
  };
  list.append(...candidates.map(form));
  if (extraDrafts.length) list.append(extrasBatch(extraDrafts, extraDrafts.map(form)));
  for (const key of approvalForms.keys()) if (!shown.has(key)) approvalForms.delete(key);
  return list;
}

/** "Add who-it's-for lines and samples to 2 pieces already for sale". @param {ExtrasCandidate[]} drafts */
function extrasHeading(drafts) {
  const lines = drafts.some(({ extras }) => extras.useful_if || extras.not_useful_if);
  const samples = drafts.some(({ extras }) => extras.sample);
  const what = [lines ? "who-it's-for lines" : "", samples ? "samples" : ""].filter(Boolean).join(" and ") || "free parts";
  const fresh = drafts.every(({ piece }) => !piece.useful_if && !piece.not_useful_if && !piece.sample);
  return `${fresh ? "Add" : "Update"} ${what} ${fresh ? "to" : "on"} ${plural(drafts.length, "piece")} already for sale`;
}

/** Updates to pieces already for sale, said once above their cards, with one way to approve them all. @param {ExtrasCandidate[]} drafts @param {HTMLElement[]} forms */
function extrasBatch(drafts, forms) {
  const box = el("div", "extras-batch");
  const head = el("div", "batch-head");
  if (approvingExtras) {
    const working = el("span", "pill");
    working.append(el("i"), document.createTextNode("Updating your store…"));
    head.append(el("b", "sans", `Approving ${plural(approvingExtras, "piece")}`), working);
    box.append(head);
    return box;
  }
  const text = el("div", "t");
  text.append(el("b", "sans", extrasHeading(drafts)), el("span", "", "Buyers see these on each piece's page. Links, prices and paid text don't change."));
  head.append(text);
  if (forms.length > 1) {
    const actions = el("div", "v");
    if (confirmingExtras) {
      const cancel = button("Cancel", "quiet", () => { confirmingExtras = false; render(); });
      const all = button(forms.length === 2 ? "Approve both" : `Approve ${forms.length}`, "primary", () => void approveAllExtras(forms));
      actions.append(el("span", "hint", `Approve all ${forms.length}? Lore updates each page on your store.`), cancel, all);
    } else {
      actions.append(button(`Approve all ${forms.length}`, "secondary", () => { confirmingExtras = true; render(); }));
    }
    head.append(actions);
  }
  box.append(head, ...forms);
  return box;
}

/** Every card in one attended decision, so the store is pushed once; the owner keeps working meanwhile. @param {HTMLElement[]} forms */
async function approveAllExtras(forms) {
  const decisions = forms.flatMap((form) => extrasApprovals.get(form)?.() ?? []);
  confirmingExtras = false;
  approvingExtras = decisions.length;
  const working = `Approving ${plural(decisions.length, "piece")} and updating your store. It takes a minute; you can keep working.`;
  tell(working);
  render();
  const done = await act(() => window.lore.approveExtras(decisions), "Approved. They go live with your next store update.");
  approvingExtras = 0;
  drop((item) => item.text === working);
  if (done) tell(`Your store is updated · ${plural(decisions.length, "piece")} have their new pages.`);
  render();
}

/** A draft as its page will read: who it's for, who it's not for, and the sample when there is one. @param {Array<[string, string]>} lines @param {string} sample */
function readLines(lines, sample) {
  const nodes = lines.filter(([, value]) => value.trim()).map(([label, value]) => {
    const line = el("p", "read-line");
    line.append(el("span", "read-label", label), document.createTextNode(value.trim()));
    return line;
  });
  if (sample.trim()) {
    const line = el("p", "read-line read-sample");
    line.append(el("span", "read-label", "Sample"), el("q", "", sample.trim()));
    nodes.push(line);
  }
  return nodes;
}

/** A card that reads like the piece's page until the owner asks to edit it. Its fields stay in the card either way, so edits survive a re-render.
 * @param {string} heading @param {() => void} preview @param {(fields: HTMLElement) => () => HTMLElement[]} build Adds the fields; returns what the card reads as. @param {boolean} [titleEdits] A field edits the heading, so the heading hides while editing. */
function readFirst(heading, preview, build, titleEdits = false) {
  const memory = el("div", "memory read-first");
  const title = el("button", "read-title", heading);
  title.type = "button";
  title.title = "Preview the page buyers see";
  title.addEventListener("click", preview);
  const read = el("div", "read");
  const fields = el("div", "fields");
  fields.hidden = true;
  const reading = build(fields);
  read.append(...reading());
  const previewButton = button("Preview page", "quiet", preview);
  previewButton.hidden = true;
  const edit = button("Edit", "quiet", () => {
    const editing = fields.hidden;
    fields.hidden = !editing;
    read.hidden = editing;
    previewButton.hidden = !editing;
    if (titleEdits) title.hidden = editing;
    edit.textContent = editing ? "Done" : "Edit";
    if (editing) {
      for (const area of fields.querySelectorAll("textarea")) fit(area);
      /** @type {HTMLElement | null} */ (fields.querySelector("input, textarea"))?.focus();
    } else {
      title.textContent = /** @type {HTMLInputElement | null} */ (fields.querySelector(".draft-title"))?.value ?? heading;
      read.replaceChildren(...reading());
    }
  });
  memory.append(title, read, fields);
  return { memory, edit, preview: previewButton };
}

/** @param {HTMLElement} memory @param {string} topic @param {HTMLElement[]} actions @param {HTMLElement[]} chips */
function approvalMeta(memory, topic, actions, ...chips) {
  const meta = el("div", "meta");
  meta.append(chip(topic), ...chips);
  const group = el("div", "group");
  group.append(...actions);
  meta.append(group);
  memory.append(meta);
}

/** @param {PublicationCandidate} candidate */
function approvalForm(candidate) {
  /** @type {Record<string, HTMLInputElement | HTMLTextAreaElement>} */
  const field = {};
  const edited = () => ({ ...candidate, title: field.title.value, teaser: field.teaser.value, useful_if: field.usefulIf.value, not_useful_if: field.notUsefulIf.value, sample: field.sample.value, content: field.paid.value });
  const card = readFirst(candidate.title, () => void previewPage(edited()), (fields) => {
    field.title = draftField(fields, "Title", candidate.title, true);
    field.teaser = draftField(fields, "Teaser · free, what buyers see first", candidate.teaser);
    field.usefulIf = draftField(fields, "Good for · free", candidate.useful_if ?? "");
    field.notUsefulIf = draftField(fields, "Not for · free", candidate.not_useful_if ?? "");
    field.sample = draftField(fields, "Sample · free, anyone can read it on the piece's page", candidate.sample ?? "");
    field.paid = draftField(fields, "Paid text · what a buyer gets", candidate.content);
    return () => {
      const paid = el("div", "read-paid");
      paid.append(el("span", "read-label", "What buyers get"), el("p", "", field.paid.value));
      return [el("p", "read-teaser", field.teaser.value), ...readLines([["Good for", field.usefulIf.value], ["Not for", field.notUsefulIf.value]], field.sample.value), paid];
    };
  }, true);
  /** @param {boolean} approved */
  const choose = async (approved) => {
    skip.disabled = approve.disabled = true;
    await decide(candidate, approved, approved ? edited() : candidate);
    if (card.memory.isConnected) skip.disabled = approve.disabled = false;
  };
  const skip = button("Skip", "secondary", () => void choose(false));
  const approve = button("Approve", "primary", () => void choose(true));
  approvalMeta(card.memory, candidate.topic, [card.preview, card.edit, skip, approve], ...(candidate.kind === "content" ? [chip("Verbatim")] : []));
  return card.memory;
}

/** New free parts for a piece already on sale: only these three fields change. @param {ExtrasCandidate} draft */
function extrasForm({ extras, piece }) {
  /** @type {Record<string, HTMLInputElement | HTMLTextAreaElement>} */
  const field = {};
  const edited = () => ({ ...extras, useful_if: field.usefulIf.value, not_useful_if: field.notUsefulIf.value, sample: field.sample.value });
  const card = readFirst(piece.title, () => void previewPage({ ...piece, ...edited(), content: "", provenance: [] }), (fields) => {
    field.usefulIf = draftField(fields, "Good for", extras.useful_if);
    field.notUsefulIf = draftField(fields, "Not for", extras.not_useful_if);
    field.sample = draftField(fields, "Sample, anyone can read it on the piece's page", extras.sample);
    return () => readLines([["Good for", field.usefulIf.value], ["Not for", field.notUsefulIf.value]], field.sample.value);
  });
  const approveEdited = () => window.lore.decideExtras({ original: extras, extras: edited(), approve: true });
  extrasApprovals.set(card.memory, () => ({ original: extras, extras: edited() }));
  /** @param {boolean} approved */
  const choose = async (approved) => {
    skip.disabled = approve.disabled = true;
    await settle(() => approved ? approveEdited() : window.lore.decideExtras({ original: extras, extras, approve: false }), approved);
    if (card.memory.isConnected) skip.disabled = approve.disabled = false;
  };
  const skip = button("Skip", "secondary", () => void choose(false));
  const approve = button("Approve", "primary", () => void choose(true));
  approvalMeta(card.memory, piece.topic, [card.preview, card.edit, skip, approve]);
  return card.memory;
}

/** The page buyers will see for a draft, rendered by the store's own code; nothing is published. @param {PublicationCandidate} candidate */
async function previewPage(candidate) {
  const live = snapshot?.node;
  const store = {
    priceUsd: snapshot?.pricing.publication_usd ?? live?.live.price_usd ?? 0.01,
    origin: live?.url ?? "https://your-store.yourlore.dev",
    test: live?.live.network === TEST_NETWORK
  };
  try {
    await window.lore.preview({ candidate, store });
  } catch (error) {
    tell(reason(error, "Lore could not show the preview."), true);
  }
}

/** Paste writing to sell: Lore keeps it privately, then drafts a piece from it. */
function openPasteSheet() {
  const form = new FormSheet("Sell something you wrote");
  const title = form.title("What it's about (optional)");
  const text = form.prompt("Your writing", "Paste a post, a postmortem, or notes");
  text.classList.add("tall");
  form.note("Saved privately to your Lore. Nothing is public until you approve a draft.");
  form.button("Cancel", "secondary", () => form.close());
  form.open({
    primary: "Draft it for sale",
    valid: () => Boolean(text.value.trim()),
    failed: "Lore could not save that.",
    submit: async () => {
      const content = text.value.trim();
      const [saved] = await window.lore.pasteMemory({ title: title.value.trim() || content.split("\n")[0].slice(0, 80), content });
      form.close();
      await publishMemory(saved);
    }
  });
}

function seamCard() {
  const box = el("div", "card lead request");
  const store = forSale(snapshot);
  box.append(el("p", "q", store ? "Push to your store now?" : "Open your store?"), el("p", "hint", pushOffer || ""));
  const actions = el("div", "actions");
  const leave = button("Not now", "secondary", () => { pushOffer = false; render(); });
  const push = store ? button(pushing ? "Pushing…" : "Push now", "primary", pushNow) : button("Open your store", "primary", () => { pushOffer = false; void startDeploy(); });
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
  if (await act(window.lore.push, "Lore couldn't update your store. Try Update store again in a minute.")) {
    const live = snapshot ? `${snapshot.publications.counts.active} ${snapshot.publications.counts.active === 1 ? "publication" : "publications"}` : "publications";
    pushedNote = `Your store is updated · ${live} for sale`;
  } else {
    pushOffer = offer;
  }
  pushing = false;
  render();
}

/** What the next push changes: approved publications the node does not hold yet, and taken-down ones it still does. Read from the snapshot, so it survives a relaunch. @param {Snapshot} s */
function unpushed(s) {
  return forSale(s) ? s.publications.items.filter((item) => item.live === (item.state === "revoked")) : [];
}

/** @param {PublicationItem[]} waiting */
function pendingLabel(waiting) {
  const adds = waiting.filter((item) => item.state === "approved").length;
  const removals = waiting.length - adds;
  return [adds ? `${adds} approved, not on your store yet` : "", removals ? `${removals} taken down, still on your store` : ""].filter(Boolean).join(" · ");
}

/** @param {Snapshot} s */
function pushReceipt(s) {
  const box = el("div", "card pad lead");
  box.append(el("span", "dot ok"));
  box.append(el("span", "", pushedNote || ""));
  if (s.node.url) box.append(outLink("See your store ↗", s.node.url.replace(/\/mcp$/, "")));
  return box;
}

/** @param {PublicationCandidate} original @param {boolean} approve @param {PublicationCandidate} [candidate] */
async function decide(original, approve, candidate = original) {
  await settle(() => window.lore.decide({ original, candidate, approve }), approve);
}

/** Apply one card, then offer the push once the last card is answered. @param {() => Promise<void>} action @param {boolean} approve */
async function settle(action, approve) {
  if ((await act(action, approve ? "Approved. It goes live with your next store update." : undefined)) && approve) approvedThisPass = true;
  if (candidates.length || extraDrafts.length) return;
  // The thread's last word was "ready for your approval below"; with every card skipped, close it.
  if (!approvedThisPass) return void (detailTask && say("Skipped. Nothing new is for sale."));
  approvedThisPass = false;
  if (forSale(snapshot)) return void (await goLive());
  pushOffer = "What you approved goes on sale once it's open. Pick a price and where payments go.";
  render();
}

/** Every change reaches the store by itself: once a change is saved, push it. */
async function goLive() {
  if (forSale(snapshot) && !pushing) await pushNow();
}

/** @param {() => Promise<void>} action @param {string} [failed] Said instead of the CLI's reason when that reason would be plumbing. */
async function act(action, failed) {
  pushOffer = false;
  pushedNote = false;
  let done = true;
  try {
    await action();
  } catch (error) {
    done = false;
    tell(failed ?? reason(error, "Lore could not do that."), true);
  }
  await load();
  return done;
}

/** @param {string} text @param {AgentTask} [from] @param {number} [memory] A memory the agent starts from, named to it and never shown. @param {string} [source] Likewise, a connected app's memories. */
async function send(text, from, memory, source) {
  const files = attachments;
  attachments = [];
  renderAttachments();
  say(text, true);
  try {
    await window.lore.prompt({ text, task, from, memory, source, files });
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
    welcomeBack.hidden = true;
    enter();
  } catch (error) {
    welcomeNote.textContent = reason(error, "Sign-in didn't complete.");
  } finally {
    offerRedirect(null);
  }
}

/** The sign-in prompt waiting for a pasted redirect URL, while the browser callback may still win. @type {string | null} */
let redirectPrompt = null;

/** @param {string | null} id */
function offerRedirect(id) {
  redirectPrompt = id;
  redirectForm.hidden = id === null;
  if (id !== null) /** @type {HTMLInputElement} */ ($("#redirect-url")).focus();
}

/** @param {string} providerId */
async function signOut(providerId) {
  auth = await window.lore.logout(providerId);
  enter();
}

/** The usage switch, with the local log of exactly what was sent. @param {Snapshot} s */
function usageRow(s) {
  const on = s.setup.telemetry_enabled !== false;
  const toggle = button(on ? "Turn off" : "Turn on", "secondary", () => void act(() => window.lore.setTelemetry(!on)));
  return row(
    "Anonymous usage",
    `${USAGE_NOTICE} They show where Lore helps and where people get stuck.`,
    cell(pill(on ? "On" : "Off", on ? "ok" : ""), button("See what's sent", "quiet", () => void window.lore.usageLog()), toggle)
  );
}

function enter() {
  const signedIn = Boolean(auth?.credentials.length);
  welcome.hidden = signedIn;
  appShell.hidden = !signedIn;
  document.body.dataset.state = signedIn ? "app" : "welcome";
  if (signedIn) {
    render();
    void firstRun.read().then(load).then(opened);
    return;
  }
  firstRun.reset();
  // Signed out: a load still out is stale, and what it would have told waits for the next sign-in.
  loads++;
  told.clear();
  drop((item) => Boolean(item.key));
}

/** An owner who has heard about usage events counts as opening Lore once a sign-in. */
function opened() {
  if (!appShell.hidden && snapshot?.setup.telemetry_enabled !== false && snapshot?.setup.telemetry_noticed) void window.lore.usage("app.opened").catch(() => undefined);
}

/** Lore's own routines are on from the start (AUT-009): once something is connected, the owner hears so once on Today, with where to change it. */
function noticeAutomations() {
  if (snapshot?.setup.automations_noticed !== false || !snapshot.library.sources.some((source) => source.enabled)) return;
  const on = (/** @type {Routine["kind"]} */ kind) => routines.find((routine) => routine.kind === kind && !routine.paused);
  const reading = on("read");
  const checkin = on("checkin");
  const parts = [
    reading && `reads your connected apps ${runsWhen({ cadence: reading.cadence, hour: reading.hour, day: reading.day ?? 0 }).replace("Every", "every")}`,
    checkin && `checks in at ${clock(checkin.hour)} when something's worth asking`
  ].filter(Boolean);
  if (parts.length) tellOnce("automations", `Lore ${parts.join(" and ")}. Change this in Automations.`, { label: "Automations", run: () => show("automations") }, () => window.lore.noticedRoutines());
}

const USAGE_NOTICE = "Lore sends anonymous usage events, like \"store opened\" or \"first piece approved\", never your writing.";

/** Someone who signed in before usage events existed hears about them once, on Today, before any is sent. */
function noticeUsage() {
  const setup = snapshot?.setup;
  if (!setup || setup.telemetry_enabled === false || setup.telemetry_noticed) return;
  tellOnce("usage", USAGE_NOTICE, { label: "Settings", run: () => show("settings") }, () => window.lore.usage("noticed").then(() => (appShell.hidden ? undefined : window.lore.usage("app.opened"))));
}

/** @param {AgentEvent} event */
function onEvent(event) {
  if (event.type === "working") {
    busy = event.active ? event.task : null;
    if (!busy) liveText = liveStatus = "";
    // A turn ending, however it ended, can bring Today's next step back.
    if (busy) syncComposer();
    else render();
    renderLog();
  }
  else if (event.type === "live") { if (event.task === task) live(event.text, event.status); }
  else if (event.type === "step") { if (event.task === task) step(event); }
  else if (event.type === "blueprint-progress") {
    if (event.task !== task) return;
    blueprintDraft = { ...blueprintDraft, ...event.fields };
    const { box } = blueprintPanel(blueprintDraft, "live");
    blueprintSlot.replaceChildren(box);
    renderLog();
  }
  else if (event.type === "changed") void load();
  else if (event.type === "sold") void loadSales();
  else if (event.type === "agents") {
    for (const landed of agentWaiting) landed(event.reads);
    void load().then(loadAgents);
  }
  else if (event.type === "ready") void load();
  else if (event.type === "show") {
    if (event.source) seeFrom(event.source);
    else {
      if (event.view === "today" && detailTask) closeTask();
      show(event.view);
    }
  }
  else if (event.type === "thread") void openTask(event.task);
  else if (event.type === "update") showUpdate(event.update);
  else if (event.type === "message") { if (event.task === task) say(event.text); }
  else if (event.type === "saved") { if (event.task === task) { lines.push({ text: "", owner: false, saved: event.memories }); renderLog(); } }
  else if (event.type === "stopped") { say(event.text, false, true); input.focus({ preventScroll: true }); }
  else if (event.type === "signed-out") {
    void window.lore.agentStatus().then((result) => {
      auth = result;
      enter();
      if (welcome.hidden) tell(event.text, true);
      else welcomeBack.textContent = `${event.text} Your memories are all still here.`;
      welcomeBack.hidden = welcome.hidden;
    });
  }
  else if (event.type === "task") {
    if (event.task.kind === "synthesize" && event.task.state !== "working") drop((item) => item.text.endsWith(READING));
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
    if (redirectPrompt === event.id) offerRedirect(null);
    if (request?.id === event.id) { clearRequest(); renderLog(); }
  } else if (event.type === "auth-prompt" && !welcome.hidden) {
    // Sign-in has no thread to hold a card, so the field lives under the note that promises it.
    offerRedirect(event.id);
  } else if (event.type === "auth") {
    const detail = event.event;
    welcomeNote.textContent = event.message || (detail?.type === "device_code" ? `Open ${detail.verificationUri} and enter ${detail.userCode}.` : detail && "message" in detail ? detail.message : "Continue signing in.");
  } else if (event.task && event.task !== detailTask) {
    // A card belongs in its own thread, never under whichever heading happens to be open.
    void openTask(event.task).then(() => renderRequest(event));
  } else renderRequest(event);
}

window.lore.onAgentEvent(onEvent);
void window.lore.update().then(showUpdate);
updateBtn.addEventListener("click", () => void window.lore.installUpdate());

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
/** Land on Today with the composer ready, carrying anything the owner already typed. @param {string} [text] */
function startCapture(text = "") {
  if (detailTask) closeTask();
  show("today");
  if (text) { input.value = text; fit(input); }
  if (composer.hidden || input.disabled) { if (text) tell("Finish what Lore is asking first. What you typed is waiting in the composer."); return; }
  input.focus();
}
addMemoryBtn.addEventListener("click", () => startCapture());
sellWritingBtn.addEventListener("click", openPasteSheet);

/* Find or capture: one gesture for both, so the owner never has to know whether a memory exists before reaching for it. */
/** @type {Array<{node: HTMLElement, verb: string, run: () => void}>} */
let paletteRows = [];
let paletteSeq = 0;
let paletteTimer = 0;

function openPalette() {
  if (palette.open) { paletteInput.select(); return; }
  closeSheet();
  hidePeek();
  paletteInput.value = "";
  void fillPalette("");
  palette.showModal();
}

/** Recent memories with nothing typed; otherwise title matches, then content matches, then a row that captures what was typed: first when nothing matched, last otherwise. @param {string} query */
async function fillPalette(query) {
  const seq = ++paletteSeq;
  const found = query ? await window.lore.search(query).catch(() => []) : [];
  if (seq !== paletteSeq) return;
  const terms = query.split(/\s+/).filter(Boolean);
  const lower = query.toLowerCase();
  const ranked = [...found.filter((hit) => hit.title.toLowerCase().includes(lower)), ...found.filter((hit) => !hit.title.toLowerCase().includes(lower))];
  paletteRows = query
    ? ranked.map((hit) => paletteRow(highlight("b", hit.title, terms), snippet(hit.content, terms), "open", () => void openMemory(Number(hit.id))))
    : (snapshot ? privateMemories(snapshot) : []).slice(0, 8).map((item) => paletteRow(el("b", "", item.title), el("span", "", [provenance(item.sources).line, when(item.updated_at)].join(" · ")), "open", () => void openMemory(item.id)));
  if (query) {
    const capture = paletteRow(el("b", "", `Capture “${query}”`), el("span", "", "Start a new memory with these words"), "capture", () => startCapture(query));
    capture.node.classList.add("capture");
    paletteRows[found.length ? "push" : "unshift"](capture);
  }
  paletteRows.forEach((row, index) => { row.node.id = `palette-row-${index}`; });
  paletteList.replaceChildren(...paletteRows.map((row) => row.node));
  selectPaletteRow(0);
}

/** @param {HTMLElement} label @param {HTMLElement} detail @param {string} verb @param {() => void} run */
function paletteRow(label, detail, verb, run) {
  const node = el("button", "palette-row");
  node.type = "button";
  node.setAttribute("role", "option");
  node.append(label, detail);
  node.addEventListener("click", () => { palette.close(); run(); });
  node.addEventListener("mousemove", () => selectPaletteRow(paletteRows.findIndex((row) => row.node === node)));
  return { node, verb, run };
}

/** The typed terms marked inside a piece of text. @param {"b" | "span"} tag @param {string} text @param {string[]} terms */
function highlight(tag, text, terms) {
  const node = el(tag);
  if (!terms.length) { node.textContent = text; return node; }
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  for (const [index, piece] of text.split(pattern).entries()) if (piece) node.append(index % 2 ? el("mark", "", piece) : piece);
  return node;
}

/** The first stretch of content around a match, so the row says why it matched. @param {string} content @param {string[]} terms */
function snippet(content, terms) {
  const text = content.replace(FRONTMATTER, "").replace(/\s+/g, " ").trim();
  const at = Math.min(...terms.map((term) => text.toLowerCase().indexOf(term.toLowerCase())).filter((index) => index >= 0), text.length);
  const start = Math.max(0, at - 40);
  return highlight("span", (start ? "…" : "") + text.slice(start, start + 140), terms);
}

/** @param {number} index */
function selectPaletteRow(index) {
  if (!paletteRows.length) { paletteInput.removeAttribute("aria-activedescendant"); return; }
  const at = (index + paletteRows.length) % paletteRows.length;
  paletteRows.forEach((row, i) => row.node.setAttribute("aria-selected", String(i === at)));
  paletteRows[at].node.scrollIntoView({ block: "nearest" });
  paletteInput.setAttribute("aria-activedescendant", paletteRows[at].node.id);
  paletteEnter.textContent = paletteRows[at].verb;
}

paletteInput.addEventListener("input", () => {
  window.clearTimeout(paletteTimer);
  paletteTimer = window.setTimeout(() => void fillPalette(paletteInput.value.trim()), 120);
});
palette.addEventListener("keydown", (event) => {
  const index = paletteRows.findIndex((row) => row.node.getAttribute("aria-selected") === "true");
  if (event.key === "ArrowDown") { event.preventDefault(); selectPaletteRow(index + 1); }
  else if (event.key === "ArrowUp") { event.preventDefault(); selectPaletteRow(index - 1); }
  else if (event.key === "Enter") { event.preventDefault(); const row = paletteRows[index]; if (row) { palette.close(); row.run(); } }
});
/** @type {HTMLFormElement} */ (palette.querySelector("form")).addEventListener("submit", (event) => event.preventDefault());
// The panel fills the dialog, so a click that lands on the dialog itself came from the backdrop.
palette.addEventListener("click", (event) => { if (event.target === palette) palette.close(); });
search.addEventListener("click", openPalette);

/* A memory's first lines on hover or focus, so a list can be read without opening each sheet. */
/** Content read once per memory until the next snapshot. @type {Map<number, Promise<Memory>>} */
const peeked = new Map();
let peekTimer = 0;
/** @type {HTMLElement | null} */
let peek = null;

/** @param {number} id */
function readPeek(id) {
  let pending = peeked.get(id);
  if (!pending) {
    pending = window.lore.memory(id);
    peeked.set(id, pending);
    pending.catch(() => peeked.delete(id));
  }
  return pending;
}

function hidePeek() {
  window.clearTimeout(peekTimer);
  peek?.remove();
  peek = null;
}

/** @param {HTMLElement} anchor @param {number} id */
function peekable(anchor, id) {
  let over = false;
  const arm = () => {
    over = true;
    window.clearTimeout(peekTimer);
    peekTimer = window.setTimeout(async () => {
      /** @type {Memory} */
      let memory;
      try { memory = await readPeek(id); } catch { return; }
      if (over && anchor.isConnected && !document.querySelector("dialog[open]")) showPeek(anchor, memory);
    }, 450);
  };
  const disarm = () => {
    over = false;
    window.clearTimeout(peekTimer);
    peekTimer = window.setTimeout(hidePeek, 150);
  };
  anchor.addEventListener("mouseenter", arm);
  anchor.addEventListener("focus", arm);
  anchor.addEventListener("mouseleave", disarm);
  anchor.addEventListener("blur", disarm);
}

/** Read-only on purpose: nothing is one accidental hover from a change. @param {HTMLElement} anchor @param {Memory} memory */
function showPeek(anchor, memory) {
  hidePeek();
  peek = el("div", "card peek");
  peek.setAttribute("role", "tooltip");
  const text = memory.content.replace(FRONTMATTER, "").replace(/\s+/g, " ").trim();
  peek.append(el("b", "", memory.title), provenanceLine(memory), el("p", "", text.slice(0, 400)));
  peek.addEventListener("mouseenter", () => window.clearTimeout(peekTimer));
  peek.addEventListener("mouseleave", hidePeek);
  peek.addEventListener("click", () => void openMemory(memory.id));
  document.body.append(peek);
  // Beside the row when there is room, below it otherwise, and never past the window edge.
  const a = anchor.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const beside = a.right + gap + peek.offsetWidth <= window.innerWidth - margin;
  let top = beside ? a.top : a.bottom + gap;
  if (top + peek.offsetHeight > window.innerHeight - margin) top = beside ? window.innerHeight - margin - peek.offsetHeight : a.top - gap - peek.offsetHeight;
  peek.style.left = `${beside ? a.right + gap : Math.min(a.left, window.innerWidth - margin - peek.offsetWidth)}px`;
  peek.style.top = `${Math.max(margin, top)}px`;
}
mainEl.addEventListener("scroll", hidePeek, { passive: true });
mainEl.addEventListener("scroll", () => mainEl.classList.toggle("scrolled", mainEl.scrollTop > 0), { passive: true });
// APP-218: what a thread scrolls into view stops clear of the floating composer, however tall it has grown.
new ResizeObserver(() => mainEl.style.setProperty("--composer-room", `${composer.offsetHeight}px`)).observe(composer);
// The account menu is a native popover: Escape and a click elsewhere close it, and its trigger says whether it is open.
for (const item of accountMenu.querySelectorAll("button")) item.addEventListener("click", () => accountMenu.hidePopover());
for (const item of /** @type {NodeListOf<HTMLButtonElement>} */ (accountMenu.querySelectorAll("[data-view]"))) item.addEventListener("click", () => show(/** @type {View} */ (item.dataset.view)));
feedbackBtn.addEventListener("click", openFeedbackDialog);
skipBtn.addEventListener("click", () => firstRun.leave("skipped"));
signOutBtn.addEventListener("click", () => { const id = auth?.credentials[0]?.providerId; if (id) void signOut(id); });
accountMenu.addEventListener("toggle", (event) => {
  account.setAttribute("aria-expanded", String(/** @type {ToggleEvent} */ (event).newState === "open"));
  if (/** @type {ToggleEvent} */ (event).newState === "open") /** @type {HTMLElement | null} */ (accountMenu.querySelector("button:not([hidden])"))?.focus();
});
accountMenu.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = [...accountMenu.querySelectorAll("button:not([hidden])")].map((item) => /** @type {HTMLElement} */ (item));
  const at = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
});
for (const nav of navButtons) nav.addEventListener("click", () => {
  const next = /** @type {View} */ (nav.dataset.view);
  if (next === "today" && detailTask) closeTask();
  else show(next);
});
welcomeRetry.addEventListener("click", () => {
  welcomeRetry.hidden = true;
  welcomeNote.textContent = "Setting Lore up on this Mac…";
  void window.lore.retrySetup();
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openPalette(); }
  if ((event.metaKey || event.ctrlKey) && event.key === ",") { event.preventDefault(); palette.close(); closeSheet(); show("settings"); }
  if (event.key === "Escape") hidePeek();
});

for (const node of document.querySelectorAll("[data-login]")) {
  node.addEventListener("click", () => {
    const [providerId, type] = /** @type {string} */ (/** @type {HTMLElement} */ (node).dataset.login).split(":");
    void signIn(providerId, /** @type {"oauth" | "api_key"} */ (type));
  });
}
$("#welcome-key").addEventListener("click", () => { keyForm.hidden = false; /** @type {HTMLInputElement} */ ($("#key-secret")).focus(); });
redirectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const field = /** @type {HTMLInputElement} */ ($("#redirect-url"));
  const value = field.value.trim();
  const id = redirectPrompt;
  if (!id || !value) return;
  field.value = "";
  offerRedirect(null);
  welcomeNote.textContent = "Finishing sign-in…";
  void window.lore.respond({ id, value });
});
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
