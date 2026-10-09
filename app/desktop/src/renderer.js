/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));
const welcome = $("#welcome");
const appShell = $("#app");
const welcomeNote = $("#welcome-note");
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
const feedbackBtn = /** @type {HTMLButtonElement} */ ($("#feedback-open"));
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

/** @typedef {"today" | "memories" | "store" | "collection" | "connectors" | "faq" | "settings"} View */
/** @type {Snapshot | null} */
let snapshot = null;
/** The apps Lore can connect, read once from the CLI's catalog. @type {SourceApp[]} */
let apps = [];
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
/** Whether the For Sale price row is open as an editor. */
let editingPrice = false;
let savingPrice = false;
let accountMenuOpen = false;
/** The collection open in its own view. @type {number | null} */
let openCollectionId = null;
/** Text pasted into the open collection and not added yet; kept across renders. */
let collectionDraft = "";
/** What the open collection is doing, said on the button doing it. @type {"" | "adding" | "pricing" | "naming"} */
let collectionBusy = "";
let editingCollectionPrice = false;
let editingFeedPrice = false;
let savingFeed = false;
/** The node's ledger, read each time For Sale opens: rows, the reason it could not be read, or null while it loads. @type {Sale[] | Error | null} */
let sales = null;
/** Page views per piece, by public id; empty until read. @type {Record<string, number>} */
let views = {};
let salesAsked = false;
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
const REDEPLOY_PRICE = "I changed my publication price. Redeploy my store so buyers pay the new amount.";
// Six decimals, not the default two: a price can run below a cent, and rounding
// $0.000001 up to $0.01 would misstate what a buyer pays. Six is the CLI's floor.
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const TASK_TITLES = { capture: "Capture a memory", setup: "Set up your Lore", publish: "Publish from your Lore", deploy: "Open your store" };
/** Stands in for the composer while a card in another thread holds the turn; its button opens that thread. @type {AgentTask | null} */
let waitingTask = null;
const waiting = el("div", "card pad lead composer-wait");
const waitingText = el("span");
waiting.append(el("span", "dot"), waitingText, button("Open", "secondary", () => { if (waitingTask) void openTask(waitingTask); }));
waiting.hidden = true;
composer.insertAdjacentElement("afterend", waiting);
const THINKING = { setup: "Thinking…", publish: "Drafting…", capture: "Reading this…", deploy: "Setting up your store…" };
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

/** @param {number | string} id @param {string} title @param {string} detail */
function memoryRow(id, title, detail) {
  const node = el("div", "row");
  const open = el("button", "task-link");
  open.type = "button";
  const text = el("div", "t");
  text.append(el("b", "", title), el("span", "", detail));
  open.append(text);
  open.addEventListener("click", () => openMemory(Number(id)));
  peekable(open, Number(id));
  node.append(open, button("Draft for sale", "quiet", () => void publishMemory({ id: Number(id), title })));
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
  const from = snapshot?.library.sources.find((source) => source.name === memory.source);
  const origin = apps.find((app) => app.id === from?.connector)?.name ?? from?.label;
  text.append(titleLabel, el("span", "", [...new Set([memory.project, origin, when(memory.updated_at)])].filter(Boolean).join(" · ")));
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
  closeSheet();
  const sheet = el("dialog", "sheet narrow");
  sheet.setAttribute("aria-label", "Report Feedback");
  const panel = el("div", "card sheet-panel");
  const head = el("div", "sheet-head");
  head.append(el("b", "", "Report Feedback"));
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  // This dialog, not whichever one is open: a report can still be in flight
  // when the owner opens something else, and closeSheet() would close that.
  close.addEventListener("click", () => sheet.close());
  head.append(close);

  const form = el("form", "feedback-form");
  const titleField = /** @type {HTMLInputElement} */ (draftField(form, "Title", "", true));
  const emailField = /** @type {HTMLInputElement} */ (draftField(form, "Email (optional)", "", true));
  const descriptionField = draftField(form, "Description", "");
  form.append(el("p", "hint", "This becomes a public GitHub issue; anything you write here, and your email if you give one, is visible there."));
  const actions = el("div", "actions");
  const cancel = el("button", "btn secondary sm", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => sheet.close());
  const send = el("button", "btn primary sm", "Send");
  send.type = "submit";
  send.disabled = true;
  actions.append(cancel, send);
  form.append(actions);

  // One report per Send, however the owner gets there. Without `sending` in
  // this predicate, the input listener re-enables Send the moment both
  // fields are non-empty again — including mid-request — and a second click
  // files a second public issue from one owner action.
  let sending = false;
  const canSend = () => !sending && Boolean(titleField.value.trim() && descriptionField.value.trim());
  form.addEventListener("input", () => { send.disabled = !canSend(); });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (canSend()) void submit();
  });

  async function submit() {
    sending = true;
    cancel.disabled = send.disabled = true;
    send.textContent = "Sending…";
    try {
      const receipt = await window.lore.reportFeedback({
        title: titleField.value,
        email: emailField.value,
        description: descriptionField.value
      });
      sheet.close();
      tell(`Filed as ${receipt.url}`);
    } catch (error) {
      tell(reason(error, "Lore could not send that."), true);
      sending = false;
      // Escape or the backdrop can dismiss this dialog while the request is
      // out, and the close handler below detaches it. Restoring the buttons
      // is then pointless, so check first, as approvalForm() does.
      if (sheet.isConnected) {
        cancel.disabled = false;
        send.disabled = !canSend();
        send.textContent = "Send";
      }
    }
  }

  panel.append(head, form);
  sheet.append(panel);
  sheet.addEventListener("click", (event) => { if (event.target === sheet) sheet.close(); });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
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

/** What buyers are charged, one entry per thing on offer; nothing when no price is set. @param {Snapshot} s @returns {Array<[string, string]>} */
function offers(s) {
  /** @type {Array<[string, string]>} */
  const list = [];
  if (typeof s.pricing.publication_usd === "number") list.push([price(s.pricing.publication_usd), "a publication"]);
  if (s.pricing.answer_enabled) list.push([price(s.pricing.answer_usd), "an answer"]);
  return list;
}

/** @param {string} iso */
function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

const RUN_LABELS = { capture: "Capture", synthesis: "Synthesis", deploy: "Store deploy", push: "Store update" };
const RUN_STATES = { running: "Running", succeeded: "Done", failed: "Failed", incomplete: "Unfinished" };
/** Job kinds with an agent thread behind them, keyed to the task that thread belongs to. Synthesis and push are plain CLI runs with no owner-facing conversation, so a Recent-runs row for either stays non-interactive. @type {Partial<Record<JobItem["kind"], AgentTask>>} */
const JOB_TASK = { capture: "capture", deploy: "deploy" };

/** Recent owner runs, newest first. Absent when the installed CLI predates them.
 * @param {Snapshot} s */
function recentRuns(s) {
  if (!s.jobs) return null;
  const all = s.jobs.items;
  const items = all.slice(0, 5);
  if (!items.length) return null;
  return section("Recent runs", card(items.map((item, index) => {
    const detail = [pushDetail(all, index) ?? item.summary, when(item.started_at), typeof item.cost_usd === "number" ? money.format(item.cost_usd) : ""].filter(Boolean);
    const label = item.title?.trim() || RUN_LABELS[item.kind] || item.kind;
    const status = chip(RUN_STATES[item.status] ?? item.status, item.status === "running" ? "ok" : item.status === "succeeded" ? "" : "attention");
    // A plain success has nothing more to show than this row already does; anything
    // else showing real cost or a confusing state should be openable, when there is
    // a thread behind it to open.
    const task = item.status === "succeeded" ? undefined : JOB_TASK[item.kind];
    if (!task) return row(label, detail.join(" · "), status);
    const node = el("div", "row");
    const open = el("button", "task-link");
    open.type = "button";
    const text = el("div", "t");
    text.append(el("b", "", label), el("span", "", detail.join(" · ")));
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

/** @param {Snapshot["node"]["live"]} live */
function payoutLink(live) {
  return live.payout ? outLink("Payouts ↗", `${explorer(live.network)}/address/${live.payout}`) : null;
}

/** @param {Snapshot["node"]} node */
function storeAddress(node) {
  const url = /** @type {string} */ (node.url);
  const box = el("span", "address");
  box.append(el("span", "mono", url.replace(/^https?:\/\//, "").replace(/\/mcp$/, "")));
  const console = workerConsole(url);
  if (console) box.append(outLink("Cloudflare ↗", console));
  const payouts = payoutLink(node.live);
  if (payouts) box.append(payouts);
  return box;
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
  if (!s.library.sources.some((source) => source.connector)) add("Bring in what you've written", "Notes, posts, or AI conversations from apps you already use.", button("Connect", "secondary", () => show("connectors")));
  if (!s.setup.sources_configured) {
    if (s.library.sources.some((source) => !source.owned)) add("Connect your agents", "Let Lore read what Claude Code and Codex already remember.", button("Start", "secondary", startSetup));
  } else if (!s.setup.blueprint_configured) add("Shape your Lore", "Review one proposal based on what your agents already know.", button("Start", "secondary", startSetup));
  else if (!s.setup.profile_configured) add("Set the rhythm", "Choose which model writes new memories, and how often.", button("Start", "secondary", startSetup));
  // The store rung waits for approved work, whatever rung setup is on: the
  // payout address is asked last, once there is something worth being paid for.
  if (s.publications.counts.active && !s.node.url && !pushOffer) add("Open your store", `${s.publications.counts.active === 1 ? "Your approved piece is" : `Your ${s.publications.counts.active} approved pieces are`} ready to sell. Pick a price and where payments go.`, button("Open", "secondary", () => void startDeploy()));
  const publishing = candidates.length || extraDrafts.length || taskItems.some((item) => item.kind === "publish");
  if (!publishing) add("Sell something you wrote", "Paste a post, a postmortem or notes. Lore drafts the piece and shows you its page.", button("Paste", "secondary", openPasteSheet));
  if (s.library.counts.private && !publishing) add("Publish something", "Lore drafts up to three things to sell; you approve each one.", button("Publish", "secondary", () => void startPublish()));
  // Approved work a buyer cannot see yet, or a price they are not yet paying, is actionable whatever rung setup is on.
  const stale = stalePrice(s);
  if (stale !== null && !pushing) add("Your new price isn't live yet", `Your store still charges ${price(stale)}. Update it to start charging ${price(s.pricing.publication_usd)}.`, button("Update store", "secondary", () => void startDeploy(REDEPLOY_PRICE)));
  const waiting = unpushed(s);
  if (waiting.length && !pushOffer && !pushing) add("Update your store", `${pendingLabel(waiting)}.`, button("Update store", "secondary", pushNow));
  return rows;
}

/** Unfinished threads, without the store's once the store is open: nothing is left to finish there. */
function displayTasks() {
  return taskItems.filter((item) => !(item.kind === "deploy" && snapshot?.node.url)).slice(0, 3);
}

function draftsPhase() {
  const count = candidates.length + extraDrafts.length;
  return `${count} ${count === 1 ? "draft" : "drafts"} to approve`;
}

/** Threads whose agent can stage a publication draft. */
const DRAFTING = new Set(["publish", "capture"]);

/** @param {Snapshot} s */
function renderToday(s) {
  /** @type {HTMLElement[]} */
  const parts = [];
  // Drafts and the push after approving show on Today and in the threads that draft.
  if (!detailTask || DRAFTING.has(detailTask)) {
    if (candidates.length || extraDrafts.length) parts.push(section("Approve what to sell", approvals(), el("span", "hint", "Buyers only ever get what you approve here.")));
    if (pushOffer || pushing) parts.push(seamCard());
    if (pushedNote) parts.push(pushReceipt(s));
  }
  if (detailTask) {
    if ((detailTask === "setup" || detailTask === "deploy") && detailRecord?.state === "done") parts.push(nextRung(s));
    return parts;
  }
  const attention = needsYou(s);
  if (attention.length) parts.push(section("Needs you", card(attention)));
  if (Array.isArray(sales) && sales.length) parts.push(earned(sales));
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
      return row;
    }))));
  }
  const runs = recentRuns(s);
  if (runs) parts.push(runs);
  const strip = el("div", "strip");
  /** @type {Array<[string, string] | null>} */
  const facts = [
    [String(s.library.counts.private), `${s.library.counts.private === 1 ? "memory" : "memories"}, only on this Mac`],
    [String(s.publications.counts.active), "for sale"],
    ["Store", nodeLabel(s.node.live.state).toLowerCase()],
    ...offers(s)
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
function memoriesCountLabel(s) {
  const count = privateMemories(s).length;
  return `${count} ${count === 1 ? "memory" : "memories"} · only on this Mac`;
}

/** @param {Snapshot} s */
function privateMemories(s) {
  return s.library.items.filter((item) => item.status === "private");
}

/** @param {Snapshot} s */
function renderMemories(s) {
  const items = privateMemories(s).map((item) => memoryRow(item.id, item.title, [item.project_label, when(item.updated_at)].filter(Boolean).join(" · ")));
  const body = items.length ? card(items) : emptyState("Nothing kept yet. Say what you learned and Lore will keep it.", button("Add your first memory", "quiet", () => startCapture()));
  return [section("", body)];
}

/** The publication price as it reads when nobody is editing it. @param {Snapshot} s */
function priceRow(s) {
  // Wrapped, not bare: `.prices` is a stretch-aligned column, so a bare button
  // would spread its hover background across the whole bar.
  const item = el("div", "price-row");
  const open = el("button", "price-open");
  open.type = "button";
  open.title = "Change what a buyer pays per publication";
  if (typeof s.pricing.publication_usd === "number") open.append(document.createTextNode(`${price(s.pricing.publication_usd)} `), el("span", "", ["a publication", freeCopies(s.pricing.free_copies)].filter(Boolean).join(" · ")));
  else open.append("Not set");
  open.addEventListener("click", () => { editingPrice = true; render(); });
  item.append(open);
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

/** @param {Snapshot} s */
function priceEditor(s) {
  const form = /** @type {HTMLFormElement} */ (el("form", "price-edit"));
  const [field, input] = priceField(typeof s.pricing.publication_usd === "number" ? String(s.pricing.publication_usd) : "");
  const actions = el("div", "actions");
  const cancel = el("button", "btn quiet sm", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => { editingPrice = false; render(); });
  const save = el("button", "btn primary sm", savingPrice ? "Saving…" : "Save");
  save.type = "submit";
  cancel.disabled = savingPrice;
  save.disabled = savingPrice;
  actions.append(cancel, save);
  form.append(field, el("span", "", "a publication"));
  /** @type {HTMLInputElement | null} */
  let copies = null;
  if (typeof s.pricing.free_copies === "number") {
    const box = el("div", "price-field copies");
    copies = el("input");
    copies.type = "text";
    copies.inputMode = "numeric";
    copies.setAttribute("aria-label", "Free copies of each piece");
    copies.value = String(s.pricing.free_copies);
    box.append(copies);
    form.append(box, el("span", "", "free copies"));
  }
  form.append(actions);
  form.addEventListener("submit", (submitEvent) => {
    submitEvent.preventDefault();
    void savePrice(input.value, copies?.value);
  });
  queueMicrotask(() => input.focus());
  return form;
}

const WHOLE_COPIES = "Free copies has to be a whole number, zero or more";

/** @param {string} raw @param {string} [rawCopies] Absent when the CLI predates free copies. */
async function savePrice(raw, rawCopies) {
  const amount = parsePrice(raw);
  if (amount === null) {
    tell(`${ABOVE_ZERO}. Free is a real choice, but you make it when you open your store.`, true);
    return;
  }
  const copies = rawCopies === undefined ? null : Number(rawCopies.trim());
  if (copies !== null && (!rawCopies?.trim() || !Number.isInteger(copies) || copies < 0)) {
    tell(`${WHOLE_COPIES}.`, true);
    return;
  }
  const before = snapshot?.pricing;
  const newCopies = copies !== null && copies !== before?.free_copies;
  savingPrice = true;
  render();
  const saved = await act(async () => {
    if (amount !== before?.publication_usd) await window.lore.setPrice(amount);
    if (newCopies && copies !== null) await window.lore.setFreeCopies(copies);
  });
  if (saved) {
    editingPrice = false;
    drop((item) => item.text.startsWith(ABOVE_ZERO) || item.text.startsWith(WHOLE_COPIES));
  }
  savingPrice = false;
  render();
  if (saved && (newCopies || amount !== before?.publication_usd)) await goLive();
}

/** @param {Snapshot} s */
function renderStore(s) {
  const live = s.node.live;
  const bar = el("div", "card store-bar");
  const lead = el("div", "lead");
  lead.append(el("span", `dot ${live.state === "online" ? "ok" : live.state === "unreachable" ? "" : "off"}`));
  const text = el("div", "t");
  text.append(el("b", "sans", live.state === "online" ? (live.network === TEST_NETWORK ? "Live · Test mode" : "Live") : live.state === "unreachable" ? "Your store isn't responding" : "No store yet"));
  if (s.node.url) {
    text.append(storeAddress(s.node));
  } else {
    const open = el("span");
    open.append(inline("Open your store", () => void startDeploy()), " when you're ready to sell.");
    text.append(open);
  }
  lead.append(text);
  const prices = el("div", "prices");
  prices.append(editingPrice ? priceEditor(s) : priceRow(s));
  if (s.pricing.answer_enabled) {
    const answers = el("div");
    answers.append(document.createTextNode(`${price(s.pricing.answer_usd)} `), el("span", "", "an answer"));
    prices.append(answers);
  }
  const stale = stalePrice(s);
  if (stale !== null && !pushing) {
    const note = el("div", "stale-price");
    note.append(el("span", "", `Your store still charges ${price(stale)}.`), button("Update store", "quiet", () => void startDeploy(REDEPLOY_PRICE)));
    prices.append(note);
  }
  bar.append(lead, prices);
  if (unpushed(s).length && !pushOffer) {
    const push = button(pushing ? "Updating…" : "Update store", "primary", pushNow);
    push.disabled = pushing;
    bar.append(push);
  }
  const approved = s.publications.items.filter((item) => item.state === "approved");
  const waiting = unpushed(s);
  const revoked = s.publications.items.filter((item) => item.state === "revoked");
  /** @param {PublicationItem} item */
  const sold = (item) => {
    const count = Array.isArray(sales) ? sales.filter((sale) => sale.item_id === item.public_id && sale.network !== "free").length : 0;
    const seen = views[item.public_id] ?? 0;
    return [item.topic, seen ? `${seen} ${seen === 1 ? "view" : "views"}` : "", count ? `${count} sold` : ""].filter(Boolean).join(" · ");
  };
  // One chip per row only when rows differ; a list all in one state says it once in the heading.
  const mixed = approved.some((item) => item.live !== approved[0].live);
  /** @param {PublicationItem} item */
  const state = (item) => mixed ? [item.live === true ? chip("Live", "ok") : item.live === false ? chip("Not live yet") : chip("Approved")] : [];
  /** @param {PublicationItem} item */
  const controls = (item) => {
    const trailing = el("div", "v");
    const ask = button("Take down", "secondary", () => {
      trailing.replaceChildren(
        el("span", "hint", "No one can buy it after this. Anyone who already did keeps their copy."),
        button("Keep", "secondary", () => trailing.replaceChildren(...state(item), ask)),
        // The CLI's reason for a push that did not land names commands and paths; the list below shows whether the store still has it.
        button("Take down", "primary", () => void act(() => window.lore.revoke(item.id), "Taken down. Your store stops selling it as soon as it updates."))
      );
    });
    trailing.append(...state(item), ask);
    return trailing;
  };
  const aside = el("div", "section-aside");
  const adds = waiting.filter((item) => item.state === "approved").length;
  const onStore = adds === 0 ? "all on your store" : adds < approved.length ? `${adds} not on your store yet` : approved.length === 1 ? "not on your store yet" : "none on your store yet";
  if (approved.length) aside.append(el("span", "hint", `${approved.length} ${approved.length === 1 ? "publication" : "publications"}${live.state === "online" ? ` · ${onStore}` : ""}`));
  if (waiting.length) {
    const push = button(pushing ? "Updating…" : "Update store", "quiet", pushNow);
    push.disabled = pushing;
    aside.append(push);
  }
  /** @type {HTMLElement[]} */
  const parts = [bar];
  if (pushOffer) parts.push(seamCard());
  if (pushedNote) parts.push(pushReceipt(s));
  if (s.feed) parts.push(feedCard(s.feed));
  parts.push(collectionsSection(s));
  parts.push(section("For sale", approved.length
    ? card(approved.map((item) => row(item.title, sold(item), controls(item))))
    : emptyState("Nothing for sale yet.", button("Draft your first piece", "quiet", () => show("memories"))),
    aside));
  if (revoked.length) parts.push(section("Taken down", card(revoked.map((item) => row(item.title, item.topic, item.live === true ? chip("Still on your store", "attention") : chip("Taken down"))))));
  parts.push(renderSales());
  return parts;
}

/** One click lets agents subscribe to everything for sale. @param {{price_usd: number, suggested_usd: number, days: number}} feed */
function feedCard(feed) {
  const box = el("div", "card pad feed-card");
  const on = feed.price_usd > 0;
  const lead = el("div", "lead");
  const text = el("div", "t");
  if (on) {
    lead.append(el("span", "dot ok"));
    text.append(el("b", "sans", `Feed on · ${price(feed.price_usd)} for ${feed.days} days`), el("span", "hint", "Agents that subscribe can read everything you sell, old and new, until their pass runs out."));
  } else {
    text.append(el("b", "sans", "Let agents subscribe to everything you sell"), el("span", "hint", `${price(feed.suggested_usd)} for ${feed.days} days, old pieces and new. You can change the price after.`));
  }
  lead.append(text);
  box.append(lead);
  if (editingFeedPrice) {
    const form = /** @type {HTMLFormElement} */ (el("form", "price-edit"));
    const [field, input] = priceField(String(on ? feed.price_usd : feed.suggested_usd));
    input.setAttribute("aria-label", `Feed price for ${feed.days} days in US dollars`);
    const save = el("button", "btn primary sm", savingFeed ? "Saving…" : "Save");
    save.type = "submit";
    save.disabled = savingFeed;
    form.append(field, el("span", "", `for ${feed.days} days`), save, button("Cancel", "quiet", () => { editingFeedPrice = false; render(); }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = parsePrice(input.value);
      if (amount === null) return void tell(`${ABOVE_ZERO}.`, true);
      void saveFeed(amount);
    });
    queueMicrotask(() => input.focus());
    box.append(form);
    return box;
  }
  const actions = el("div", "actions");
  if (on) {
    actions.append(button("Change price", "quiet", () => { editingFeedPrice = true; render(); }), button(savingFeed ? "Turning off…" : "Turn off", "secondary", () => void saveFeed(0)));
  } else {
    actions.append(button(savingFeed ? "Turning on…" : "Turn on feed", "primary", () => void saveFeed(null)));
  }
  for (const control of actions.querySelectorAll("button")) /** @type {HTMLButtonElement} */ (control).disabled = savingFeed;
  box.append(actions);
  return box;
}

/** Null turns it on at the suggested price; zero turns it off. @param {number | null} amount */
async function saveFeed(amount) {
  savingFeed = true;
  render();
  const done = await act(() => amount === 0 ? window.lore.feedOff() : window.lore.setFeed(amount).then(() => undefined));
  savingFeed = false;
  if (done) {
    editingFeedPrice = false;
    const feed = snapshot?.feed;
    const live = Boolean(snapshot?.node.url);
    if (amount === 0) tell("Feed off. Passes already bought keep working until they run out.");
    else tell(live ? `Feed on at ${price(feed?.price_usd ?? amount ?? 0)} for ${feed?.days ?? 30} days.` : "Feed on. Agents can subscribe once your store is open.", false, live ? undefined : { label: "Open your store", run: () => void startDeploy() });
  }
  render();
}

/** @returns {CollectionItem | undefined} */
function openCollection() {
  return snapshot?.collections?.items.find((item) => item.id === openCollectionId);
}

/** @param {CollectionItem | undefined} item */
function collectionEyebrow(item) {
  if (!item) return "Collection";
  return item.on_sale ? `Collection · On sale at ${price(item.price_usd)}` : "Collection · Not on sale yet";
}

/** @param {CollectionItem} item */
function collectionDetail(item) {
  const count = `${item.pieces.length} ${item.pieces.length === 1 ? "piece" : "pieces"}`;
  return item.on_sale ? `${count} · ${price(item.price_usd)} for all of them` : `${count} · not on sale yet`;
}

/** For Sale's collections, each opening its own view. @param {Snapshot} s */
function collectionsSection(s) {
  const items = s.collections?.items ?? [];
  const make = button("New collection", "quiet", () => void newCollection());
  if (!items.length) return section("Collections", emptyState("Sell a set of pieces together, at one price.", make));
  const rows = items.map((item) => {
    const node = el("button", "row link");
    node.type = "button";
    const text = el("div", "t");
    text.append(el("b", "", item.title), el("span", "", collectionDetail(item)));
    node.append(text, item.on_sale ? chip("On sale", "ok") : chip("Draft"));
    node.addEventListener("click", () => showCollection(item.id));
    return node;
  });
  return section("Collections", card(rows), make);
}

/** @param {number} id */
function showCollection(id) {
  openCollectionId = id;
  if (detailTask) closeTask();
  show("collection");
}

/** Step one: the collection exists the moment it's asked for. */
async function newCollection() {
  if (collectionBusy) return;
  /** @type {NewCollection | null} */
  let made = null;
  if (await act(async () => { made = await window.lore.newCollection(); })) {
    if (made) showCollection(/** @type {NewCollection} */ (made).id);
    queueMicrotask(() => /** @type {HTMLElement | null} */ (document.querySelector(".drop-zone textarea"))?.focus());
  }
}

/** Step two: dropped files or pasted text, each one piece. @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input */
async function addToCollection(input) {
  const item = openCollection();
  if (!item || collectionBusy) return;
  const files = (input.files ?? []).filter((path) => {
    if (!GUARDED.test(path)) return true;
    tell(`${path.split("/").pop()} looks like a credential or hidden file, so Lore won't add it.`, true);
    return false;
  });
  if (!files.length && !input.items?.length) return;
  collectionBusy = "adding";
  render();
  /** @type {{added: Array<{title: string}>} | null} */
  let result = null;
  const done = await act(async () => { result = await window.lore.addToCollection(item.id, { items: input.items, files }); });
  collectionBusy = "";
  if (done && result) {
    if (input.items?.length) collectionDraft = "";
    const added = /** @type {{added: Array<{title: string}>}} */ (result).added.length;
    const after = openCollection();
    tell(added === 1 ? "Added 1 piece." : `Added ${added} pieces.`, false, after && !after.on_sale ? { label: "Price it", run: () => { editingCollectionPrice = true; render(); } } : undefined);
  }
  render();
}

function addPasted() {
  const text = collectionDraft.trim();
  if (!text) return void tell("Paste or type something first.", true);
  const first = text.split("\n").find((line) => line.trim())?.replace(/^#+\s*/, "").trim() ?? "";
  const title = first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
  void addToCollection({ items: [{ title, content: text }] });
}

/** @param {CollectionItem} item @param {string} raw */
async function renameCollection(item, raw) {
  const name = raw.trim();
  if (!name || name === item.title || collectionBusy) return;
  collectionBusy = "naming";
  await act(() => window.lore.renameCollection(item.id, name));
  collectionBusy = "";
  render();
}

/** Step three: a price puts it on sale; zero takes it off. @param {CollectionItem} item @param {number} amount */
async function priceCollection(item, amount) {
  collectionBusy = "pricing";
  render();
  const done = await act(() => window.lore.priceCollection(item.id, amount));
  collectionBusy = "";
  if (done) {
    editingCollectionPrice = false;
    const live = Boolean(snapshot?.node.url);
    if (amount === 0) tell("Taken off sale. Its pieces are still for sale one by one.");
    else tell(live ? `On sale at ${price(amount)}. Buyers can get all of it in one go.` : `Priced at ${price(amount)}. It goes on sale once your store is open.`, false, live ? undefined : { label: "Open your store", run: () => void startDeploy() });
  }
  render();
}

/** @param {CollectionItem} item */
function collectionPrice(item) {
  const box = el("div", "card pad collection-price");
  const busy = collectionBusy === "pricing";
  if (item.on_sale && !editingCollectionPrice) {
    const line = el("div", "lead");
    line.append(el("span", "dot ok"), el("span", "", `On sale at ${price(item.price_usd)} for all ${item.pieces.length} ${item.pieces.length === 1 ? "piece" : "pieces"}`));
    const actions = el("div", "actions");
    actions.append(
      button("Change price", "quiet", () => { editingCollectionPrice = true; render(); }),
      button(busy ? "Taking off…" : "Take off sale", "secondary", () => void priceCollection(item, 0))
    );
    box.append(line, actions);
    if (item.value_usd > item.price_usd) box.append(el("p", "hint", `Worth ${price(item.value_usd)} one by one.`));
    return box;
  }
  const form = /** @type {HTMLFormElement} */ (el("form", "price-edit"));
  const [field, input] = priceField(item.price_usd > 0 ? String(item.price_usd) : "");
  input.setAttribute("aria-label", "Price for the whole collection in US dollars");
  input.placeholder = item.value_usd > 0 ? String(Math.max(1, Math.round(item.value_usd * 0.8))) : "10";
  const save = el("button", "btn primary sm", busy ? "Saving…" : item.on_sale ? "Update price" : "Put on sale");
  save.type = "submit";
  save.disabled = busy || !item.pieces.length;
  form.append(field, el("span", "", "for the whole collection"), save);
  if (item.on_sale) form.append(button("Cancel", "quiet", () => { editingCollectionPrice = false; render(); }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = parsePrice(input.value);
    if (amount === null) return void tell(`${ABOVE_ZERO}.`, true);
    void priceCollection(item, amount);
  });
  box.append(form);
  const hint = !item.pieces.length ? "Add a piece first, then price it."
    : item.value_usd > 0 ? `Its ${item.pieces.length} ${item.pieces.length === 1 ? "piece costs" : "pieces cost"} ${price(item.value_usd)} one by one. A lower price here gives buyers a reason to take them all.`
    : "Buyers pay this once and get every piece in it.";
  box.append(el("p", "hint", hint));
  if (editingCollectionPrice) queueMicrotask(() => input.focus());
  return box;
}

/** @param {CollectionItem} item @param {{id: number, title: string}} piece */
function collectionPiece(item, piece) {
  const trailing = el("div", "v");
  const ask = button("Remove", "quiet", () => {
    trailing.replaceChildren(
      el("span", "hint", "It comes off sale too. Anyone who already bought it keeps their copy."),
      button("Keep", "secondary", () => trailing.replaceChildren(ask)),
      button("Remove", "primary", () => void act(() => window.lore.removeFromCollection(item.id, piece.id)))
    );
  });
  trailing.append(ask);
  return row(piece.title, "", trailing);
}

/** A collection in three steps: name it, fill it, price it. @param {Snapshot} s */
function renderCollection(s) {
  const item = openCollection();
  if (!item) return [emptyState("This collection is gone.", button("Back to For Sale", "quiet", () => show("store")))];
  const busy = Boolean(collectionBusy);

  const name = el("input", "collection-name");
  name.type = "text";
  name.value = item.title;
  name.maxLength = 120;
  name.setAttribute("aria-label", "Collection name");
  name.disabled = busy;
  name.addEventListener("keydown", (event) => { if (event.key === "Enter") name.blur(); if (event.key === "Escape") { name.value = item.title; name.blur(); } });
  name.addEventListener("change", () => void renameCollection(item, name.value));

  const zone = el("div", "card drop-zone");
  const lead = el("div", "drop-lead");
  lead.append(el("b", "", collectionBusy === "adding" ? "Adding…" : "Drop files here"), el("span", "hint", "Each file becomes one piece. Or paste text below."));
  const choose = button("Choose files", "secondary", async () => void addToCollection({ files: await window.lore.pickFiles() }));
  choose.disabled = busy;
  lead.append(choose);
  const paste = el("textarea");
  paste.rows = 3;
  paste.placeholder = "Paste a post, a note, anything you wrote. The first line becomes its title.";
  paste.setAttribute("aria-label", "Paste text to add as a piece");
  paste.value = collectionDraft;
  paste.disabled = busy;
  paste.addEventListener("input", () => { collectionDraft = paste.value; fit(paste); });
  paste.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); addPasted(); } });
  const add = button(collectionBusy === "adding" ? "Adding…" : "Add", "primary", addPasted);
  add.disabled = busy;
  const pasteRow = el("div", "paste-row");
  pasteRow.append(paste, add);
  zone.append(lead, pasteRow);

  const pieces = item.pieces.length
    ? card(item.pieces.map((piece) => collectionPiece(item, piece)))
    : el("div", "card pad empty", "Nothing in it yet. Drop a file or paste some text above.");

  const remove = button("Delete collection", "quiet", () => {
    foot.replaceChildren(
      el("span", "hint", "Its pieces stay for sale one by one."),
      button("Keep", "secondary", () => foot.replaceChildren(remove)),
      button("Delete", "primary", async () => { if (await act(() => window.lore.deleteCollection(item.id))) { openCollectionId = null; show("store"); } })
    );
  });
  const foot = el("div", "collection-foot");
  foot.append(remove);

  return [
    section("Name", name),
    section("Add to it", zone),
    section("In this collection", pieces, item.pieces.length ? el("span", "hint", `${item.pieces.length} ${item.pieces.length === 1 ? "piece" : "pieces"}`) : undefined),
    section("Price", collectionPrice(item)),
    foot
  ];
}

function renderSales() {
  if (sales instanceof Error) return section("Sales", emptyState(sales.message, button("Try again", "secondary", () => void loadSales())));
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
  if (sale.network === "free") return row(sale.title, `${when(sale.sold_at)} · a free copy`, cell(el("span", "mono", "Free")));
  const byCard = sale.network === "stripe";
  const trailing = el("div", "v");
  const [where, href] = byCard ? ["Stripe", `https://dashboard.stripe.com/payments/${sale.tx}`] : ["Basescan", `${explorer(sale.network)}/tx/${sale.tx}`];
  const receipt = outLink("↗", href, "link-btn glyph");
  receipt.title = `See this payment on ${where} · ${sale.tx}`;
  receipt.setAttribute("aria-label", `See this payment on ${where}`);
  if (sale.refund_owed) trailing.append(chip("Refund owed", "attention"));
  trailing.append(el("span", "mono", price(sale.price_usd)), receipt);
  // Paid for and never delivered: Lore can't send money from your wallet or Stripe account, so it says whom to refund.
  const why = byCard ? "taken down before delivery" : "not answered";
  const who = sale.payer ? `, refund ${sale.payer.slice(0, 6)}…${sale.payer.slice(-4)}` : "";
  const owed = sale.refund_owed ? ` · ${why}${who}` : "";
  return row(sale.title, `${when(sale.sold_at)} · ${byCard ? "by card" : "by an agent"}${owed}`, trailing);
}

/** Today: what the store has earned, and the latest few sales. @param {Sale[]} rows */
function earned(rows) {
  const head = row(`${price(total(rows))} earned`, `${tally(rows)} · paid straight to you; Lore never holds it`, cell(button("See all", "quiet", () => show("store"))), false);
  return section("Earned", card([head, ...rows.slice(0, 3).map(saleRow)]));
}

/** Read the ledger for the open store; without one there is nothing to read. */
async function loadSales() {
  salesAsked = true;
  sales = null;
  try {
    [sales, views] = snapshot?.node.url ? await Promise.all([window.lore.sales(), window.lore.views().catch(() => views)]) : [[], {}];
  } catch (error) {
    sales = new Error(reason(error, "Lore could not read your sales."));
  }
  render();
}

/** A credential's plain name and icon; the signed-in one when none is given. @param {{providerId: string} | null} [credential] @returns {[string, string]} */
function provider(credential = auth?.credentials[0] ?? null) {
  return credential ? PROVIDERS[credential.providerId] ?? [credential.providerId, ""] : ["Your AI provider", ""];
}

const EXECUTORS = { claude: "Claude", codex: "Codex" };

/** The rhythm as the owner would say it: "Every day at 9 PM". @param {NonNullable<Snapshot["setup"]["schedule"]>} schedule */
function rhythm(schedule) {
  const hour = schedule.hour ?? 21;
  return `Every ${schedule.cadence === "weekly" ? "Monday" : "day"} at ${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** What the last synthesis run did, from the same history Today shows. @param {Snapshot} s */
function lastSynthesis(s) {
  const run = s.jobs?.items.find((item) => item.kind === "synthesis");
  if (!run) return "Hasn't run yet.";
  const date = when(run.started_at);
  return run.status === "running" ? "Running now." : run.status === "succeeded" ? `Last ran ${date}.` : run.status === "failed" ? `Last run failed, ${date}.` : `Last run, ${date}, never finished.`;
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

/** Settings → How often Lore reads them: the scheduler's answer, not the profile's. A saved rhythm that nothing runs says so and offers the fix. @param {Snapshot} s */
function scheduleRow(s) {
  const label = "How often Lore reads them";
  const schedule = s.setup.schedule;
  if (!s.setup.profile_configured || schedule === undefined) {
    return row(label, "New memories are written from what your agents learned.", cell(pill(s.setup.profile_configured ? "Set" : "Not set", s.setup.profile_configured ? "ok" : ""), ...(s.setup.profile_configured ? [] : [button("Start", "secondary", startSetup)])), false);
  }
  if (!schedule?.executor) return row(label, "Your rhythm is saved, but no model was chosen to run it.", cell(pill("Not scheduled", "attention"), button("Start", "secondary", startSetup)), false);
  const who = `${rhythm(schedule)} with ${EXECUTORS[schedule.executor]}`;
  if (schedule.installed) return row(label, `${who}. ${lastSynthesis(s)}`, cell(pill("Scheduled", "ok")), false);
  return row(label, `Set for ${who.charAt(0).toLowerCase()}${who.slice(1)}, but nothing on this Mac is running it.`, cell(pill("Not scheduled", "attention"), button("Schedule", "secondary", () => void act(window.lore.schedule))), false);
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
      tell(account ? (s.node.url ? "Card payments are on. Lore is updating your store so buyers see Buy by card." : "Card payments are on. They start when your store opens.") : "Card payments are off.");
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
  if (!payout) return way(by, s.node.url ? "Lore can't see your store's wallet right now." : "You choose a wallet when your store opens.");
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
  return row("Address", detail, cell(pill(nodeLabel(live.state), live.state === "online" ? "ok" : live.state === "unreachable" ? "attention" : ""), outLink("Open ↗", home)), false);
}

/** Read the listing state once per store address; Settings re-renders when it lands. @param {Snapshot} s */
function loadListing(s) {
  if (!s.node.url || listingFor === s.node.url) return;
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
  if (!s.node.url) return [];
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
  const node = el("img", "logo");
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
    const node = row(source.label, source.enabled ? `${plural(source.imported, "memory")} imported` : "Not connected", cell(pill(source.enabled ? "Connected" : "Off", source.enabled ? "ok" : "")), false);
    node.prepend(brand(AGENT_MARKS[source.name] ?? source.name, source.label));
    return node;
  });
  for (const app of apps) {
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

/** A narrow modal: a title, the app's mark, and whatever follows. It opens on the first thing to
 * fill in or do, not on ×. @param {string} title @param {HTMLElement} mark @param {HTMLElement[]} body */
function sheet(title, mark, ...body) {
  closeSheet();
  const node = el("dialog", "sheet narrow");
  node.setAttribute("aria-label", title);
  const panel = el("div", "card sheet-panel");
  const head = el("div", "sheet-head");
  const text = el("div", "t");
  text.append(el("b", "", title));
  const close = el("button", "icon-btn", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => node.close());
  head.append(mark, text, close);
  panel.append(head, ...body);
  node.append(panel);
  node.addEventListener("click", (event) => { if (event.target === node) node.close(); });
  node.addEventListener("close", () => node.remove());
  document.body.append(node);
  node.showModal();
  /** @type {HTMLElement | null} */ (panel.querySelector("input") ?? panel.querySelector(".btn.primary:not(:disabled), .btn.secondary") ?? panel.querySelector(".actions .btn"))?.focus();
  return node;
}

/** A quiet line in a sheet for what went wrong there, so the owner corrects it in place. */
function problemLine() {
  const node = el("p", "problem");
  node.setAttribute("role", "alert");
  return node;
}

/** Connect from a sheet: it closes once the app is read, says in place why not, and closing it first
 * stops the connect. @param {HTMLDialogElement} dialog @param {HTMLElement} problem @param {SourceApp} app
 * @param {() => Promise<SourceEntry>} work @returns {Promise<boolean>} Whether it connected. */
async function connectIn(dialog, problem, app, work) {
  const stop = () => void window.lore.cancelConnect();
  dialog.addEventListener("close", stop);
  problem.textContent = "";
  try {
    const added = await work();
    dialog.removeEventListener("close", stop);
    dialog.close();
    tell(`${app.name} is connected. ${stateOf(app, added).line(app, added)}`, false, added.imported ? sellAction(added) : undefined);
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
  const list = el("div", "choices");
  const lead = el("p", "", `Choose a ${unit}.`);
  const actions = el("div", "actions");
  const problem = problemLine();
  const connect = button(kind === "export" ? "Import" : `Connect ${name}`, "primary", async () => {
    if (!locator) return;
    connect.disabled = true;
    connect.disabled = await connectIn(dialog, problem, app, () => window.lore.connectSource({ connector: app.id, locator, ...(current ? { replace: current.name } : {}) }));
  });
  connect.disabled = true;
  /** @param {SourceChoice} choice @param {boolean} checked */
  function option(choice, checked) {
    const label = el("label", "choice");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "choice";
    radio.checked = checked;
    radio.addEventListener("change", () => { locator = choice.locator; connect.disabled = false; });
    label.append(radio, el("b", "", choice.label), el("span", "hint mono", choice.locator));
    list.append(label);
    if (checked) radio.dispatchEvent(new Event("change"));
  }
  if (kind === "feed") {
    lead.textContent = `Where is your ${unit}?`;
    const field = el("input");
    field.type = "url";
    field.placeholder = app.placeholder;
    field.setAttribute("aria-label", `${name} address`);
    field.addEventListener("input", () => { locator = field.value.trim(); connect.disabled = !locator; });
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") connect.click(); });
    list.append(field);
  } else {
    /** @type {SourceChoice[]} */
    let choices = [];
    try {
      choices = await window.lore.sourceChoices(app.id);
    } catch (error) {
      tell(reason(error, "Lore could not look for that."), true);
      return;
    }
    for (const choice of choices) option(choice, false);
    if (!choices.length) lead.textContent = kind === "folder" ? `No ${many(unit)} found on this Mac.` : `Choose the ${unit} you downloaded.`;
    const pick = kind === "folder" ? () => window.lore.pickFolder() : () => window.lore.pickFiles().then((paths) => paths[0] ?? null);
    actions.append(button(kind === "folder" ? "Choose a folder…" : "Choose a file…", "quiet", () => void pick().then((path) => {
      if (path) option({ label: path.split("/").at(-1) ?? path, locator: path, open: false }, true);
    })));
  }
  actions.append(connect);
  const dialog = sheet(name, logo(app), lead, ...(app.guide ? [el("p", "hint", app.guide)] : []), list, el("p", "hint", "Read only. Stays on this Mac."), problem, actions);
}

/** Sign in to an app that runs its own server: its own page, in the browser, lets Lore in, and Lore
 * then reads it. Closing the sheet stops the wait. @param {SourceApp} app */
function openSignIn(app) {
  const { name } = app;
  const invite = `Lore opens ${name} in your browser. Approve there, and Lore brings in ${app.what.toLowerCase()}.`;
  const lead = el("p", "", invite);
  const actions = el("div", "actions");
  const problem = problemLine();
  const start = button(`Sign in to ${name}`, "primary", () => void begin());
  async function begin() {
    lead.textContent = "Waiting for you to approve in your browser…";
    actions.replaceChildren(button("Cancel", "quiet", () => dialog.close()));
    if (await connectIn(dialog, problem, app, () => window.lore.signIn(app.id))) return;
    lead.textContent = invite;
    actions.replaceChildren(start);
    start.focus();
  }
  actions.append(start);
  const dialog = sheet(name, logo(app), lead, el("p", "hint", "Read only. Stays on this Mac."), problem, actions);
}

/** What a connected app reads, where it stands, and what can be done to it. @param {SourceApp} app @param {SourceEntry} source */
function openConnection(app, source) {
  const { name, unit } = app;
  const state = stateOf(app, source);
  const sell = sellAction(source);
  const actions = el("div", "actions");
  const signedOut = state === SIGNED_OUT;
  const resting = [
    ...(source.imported ? [button(sell.label, "secondary", sell.run)] : []),
    ...(signedOut
      ? []
      : source.state === "needs_permission"
        ? [button("Open System Settings", "secondary", () => void window.lore.openPrivacySettings())]
        : source.refresh === false
          ? []
          : [button("Read again", "secondary", () => void act(async () => {
            const [read] = await window.lore.readSource(source.name);
            dialog.close();
            tell(read?.added ? `${plural(read.added, `new ${app.item}`)}.` : "Nothing new.");
          }))]),
    app.kind === "mcp"
      ? button("Sign in again", signedOut ? "secondary" : "quiet", () => openSignIn(app))
      : button(`Change ${unit}`, "quiet", () => void openConnect(app, source)),
    button("Disconnect", "quiet", ask)
  ];
  function ask() {
    const kept = source.imported ? ` The ${plural(source.imported, "memory")} it brought in ${source.imported === 1 ? "stays" : "stay"} in your library.` : "";
    const which = source.label || name;
    const confirm = el("div", "actions");
    const purge = button("Delete them too", "quiet", () => void remove(false));
    purge.classList.add("destructive");
    confirm.append(
      ...(source.imported ? [purge] : []),
      button("Cancel", "quiet", () => openConnection(app, source)),
      button("Disconnect", "secondary", () => void remove(true))
    );
    sheet(`Disconnect ${which}?`, logo(app), el("p", "", `Lore stops reading ${which}.${kept}`), confirm);
  }
  /** @param {boolean} keep */
  async function remove(keep) {
    await act(async () => {
      const { memories } = await window.lore.removeSource(source.name, keep);
      closeSheet();
      tell(memories.deleted ? `Disconnected. ${plural(memories.deleted, "memory")} deleted.` : `Disconnected. ${plural(memories.kept, "memory")} kept.`);
    });
  }
  actions.replaceChildren(...resting);
  const standing = source.refresh === false ? `Read once. Change ${unit} to bring in a newer one.` : snapshot?.setup.schedule?.installed ? `Lore looks for new ${many(app.item)} each time your schedule runs.` : `Lore looks for new ${many(app.item)} only when you choose Read again.`;
  const dialog = sheet(name, logo(app), el("p", "", source.label === name ? state.line(app, source) : `${source.label} · ${state.line(app, source)}`), ...(app.kind === "mcp" ? [] : [el("p", "hint mono", source.locator ?? "")]), el("p", "hint", standing), actions);
}

/** Connectors: where memories come from, and how often Lore reads them. First class: the way
 * context gets into Lore, not a preference. @param {Snapshot} s */
function renderConnectors(s) {
  return [section("Where memories come from", card([...sourceRows(s), scheduleRow(s)]))];
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
    ]))
  ];
}

const renderers = { today: renderToday, memories: renderMemories, store: renderStore, collection: renderCollection, connectors: renderConnectors, faq: renderFaq, settings: renderSettings };

function render() {
  hidePeek();
  const detail = view === "today" ? detailTask : null;
  const heading = detail ? detailRecord?.title ?? TASK_TITLES[detail] : { today: greeting(), memories: "Memories", store: "For Sale", collection: openCollection()?.title ?? "Collection", connectors: "Connectors", faq: "FAQ", settings: "Settings" }[view];
  const pendingDrafts = detail === "publish" && (candidates.length || extraDrafts.length);
  eyebrow.textContent = detail
    ? pendingDrafts ? `Needs you · ${draftsPhase()}` : `${TASK_STATES[detailRecord?.state ?? "working"]} · ${detailRecord?.phase ?? "Starting"}`
    : view === "today" ? longDate.format(new Date())
    : view === "memories" && snapshot ? memoriesCountLabel(snapshot)
    : view === "collection" ? collectionEyebrow(openCollection()) : "";
  title.textContent = heading;
  taskBack.hidden = !detail;
  taskRestart.hidden = !detail || detailRecord?.state !== "stopped";
  addMemoryBtn.hidden = Boolean(detail) || view !== "memories";
  captureArea.hidden = view !== "today";
  log.hidden = !detail;
  syncComposer();
  // A collection is something for sale, so For Sale stays lit while one is open.
  for (const nav of navButtons) nav.setAttribute("aria-pressed", String(nav.dataset.view === (view === "collection" ? "store" : view)));
  if (!snapshot) return;
  $("[data-count=memories]").textContent = String(snapshot.library.counts.private);
  $("[data-count=store]").textContent = String(snapshot.publications.counts.active);
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

function renderAccount() {
  account.replaceChildren();
  const credential = auth?.credentials[0];
  if (!credential) return;
  const [name, icon] = provider(credential);
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
  line.append(document.createTextNode(`${name}${snapshot?.node.url ? ` · ${store}` : ""}`));
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
    menu.append(item("Open Settings", () => show("settings")), item(`Sign out of ${name}`, () => void signOut(credential.providerId)));
    account.append(menu);
    /** @type {HTMLElement | null} */ (menu.querySelector("button"))?.focus({ preventScroll: true });
  }
}

/** @param {View} next */
function show(next) {
  view = next;
  if (next === "store") void loadSales();
  // Leaving For Sale abandons a half-typed price rather than keeping the field
  // open behind the owner's back.
  if (next !== "store") { editingPrice = false; editingFeedPrice = false; }
  if (next !== "collection") { editingCollectionPrice = false; collectionDraft = ""; }
  // A store update said once, where it happened; it doesn't follow the owner around.
  pushedNote = false;
  render();
  mainEl.scrollTop = 0;
  mainEl.focus({ preventScroll: true });
}

/** Every "change the price" affordance lands on the one editor, on For Sale. */
function openPriceEditor() {
  editingPrice = true;
  detailTask = null;
  detailRecord = null;
  show("store");
}

async function load() {
  if (!snapshot) content.replaceChildren(el("p", "hint", "Loading…"));
  try {
    [snapshot, candidates, extraDrafts, taskItems, apps] = await Promise.all([window.lore.snapshot(), window.lore.candidates().catch(() => []), window.lore.extras().catch(() => []), window.lore.tasks().catch(() => []), apps.length ? apps : window.lore.sourceCatalog().catch(() => [])]);
    if (detailTask) detailRecord = taskItems.find((item) => item.kind === detailTask) ?? detailRecord;
    peeked.clear();
    render();
    // Today's earnings need the ledger once; after that a new sale or For Sale reads it again.
    if (!salesAsked && snapshot.node.url) void loadSales();
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

/** @typedef {{label: string, run: () => void}} NoticeAction */
/** @type {Array<{text: string, attention: boolean, action?: NoticeAction}>} */
const notices = [];

/** Something Lore did or could not do, said where the owner is: in the open thread, or as a notice above the page when the log is hidden, scrolled into view. A newer success replaces an older one. @param {string} text @param {boolean} [attention] @param {NoticeAction} [action] The one next step, on the notice. */
function tell(text, attention = false, action) {
  if (!log.hidden) { say(text, false, attention); return; }
  if (!attention) drop((item) => !item.attention);
  notices.push({ text, attention, action });
  if (notices.length > 3) notices.shift();
  renderNotices();
  status.scrollIntoView({ block: "nearest" });
}

/** @param {(item: typeof notices[number]) => boolean} which */
function drop(which) {
  notices.splice(0, notices.length, ...notices.filter((item) => !which(item)));
  renderNotices();
}

function renderNotices() {
  status.replaceChildren(...notices.map((item) => {
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

/** Lore's typing bubble while its turn is open, with what it is doing beside it. @param {string} label */
function thinkingLine(label) {
  const line = el("div", "line live thinking");
  const bubble = el("span", "bubble");
  bubble.append(el("i"), el("i"), el("i"));
  line.setAttribute("role", "status");
  line.append(mark("mark mark-sm"), bubble, el("span", "", label));
  return line;
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
  const thinking = busy !== null && !request;
  if (thinking && busy) log.append(thinkingLine(liveStatus || THINKING[busy] || ""));
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
  const storeOpen = Boolean(s.node.url);
  const heading = deploy ? (storeOpen ? "Your store is open." : "Your store isn't open yet.") : "Your Lore is set up.";
  const detail = deploy
    ? storeOpen
      ? storeOpened(s)
      : "This step is done. Try again now, or any time from Today."
    : "This step is done. What comes next is a separate step — take it now, or any time from Today.";
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
      drop((item) => Boolean(item.action));
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
  const form = el("div", "feedback-form");
  const title = draftField(form, "What it's about (optional)", "", true);
  const text = /** @type {HTMLTextAreaElement} */ (draftField(form, "Your writing: a post, a postmortem, or notes", ""));
  text.rows = 8;
  const problem = problemLine();
  const draft = button("Draft it for sale", "primary", async () => {
    const content = text.value.trim();
    if (!content) { problem.textContent = "Paste something first."; return; }
    draft.disabled = true;
    try {
      const [saved] = await window.lore.pasteMemory({ title: title.value.trim() || content.split("\n")[0].slice(0, 80), content });
      dialog.close();
      await publishMemory(saved);
    } catch (error) {
      problem.textContent = reason(error, "Lore could not save that.");
      draft.disabled = false;
    }
  });
  const actions = el("div", "actions");
  actions.append(button("Cancel", "secondary", () => dialog.close()), draft);
  form.append(el("p", "hint", "Saved privately to your Lore. Nothing is public until you approve a draft."), problem, actions);
  const dialog = sheet("Sell something you wrote", mark(), form);
}

function seamCard() {
  const box = el("div", "card lead request");
  const store = Boolean(snapshot?.node.url);
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
  return s.node.url ? s.publications.items.filter((item) => item.live === (item.state === "revoked")) : [];
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
  if (snapshot?.node.url) return void (await goLive());
  pushOffer = "What you approved goes on sale once it's open. Pick a price and where payments go.";
  render();
}

/** Every change reaches the store by itself: once a change is saved, push it. */
async function goLive() {
  if (snapshot?.node.url && !pushing) await pushNow();
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
  const files = attachments.length ? `\n\nFiles to read:\n${attachments.map((path) => `- ${path}`).join("\n")}` : "";
  attachments = [];
  renderAttachments();
  say(text, true);
  try {
    await window.lore.prompt({ text: text + files, task, from, memory, source });
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
    if (!busy) liveText = liveStatus = "";
    syncComposer();
    renderLog();
  }
  else if (event.type === "live") { if (event.task === task) live(event.text, event.status); }
  else if (event.type === "blueprint-progress") {
    if (event.task !== task) return;
    blueprintDraft = { ...blueprintDraft, ...event.fields };
    const { box } = blueprintPanel(blueprintDraft, "live");
    blueprintSlot.replaceChildren(box);
    renderLog();
  }
  else if (event.type === "changed") void load();
  else if (event.type === "sold") void loadSales();
  else if (event.type === "show") show(event.view);
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
  document.addEventListener(type, (event) => { event.preventDefault(); (view === "collection" ? document.querySelector(".drop-zone") ?? composer : composer).classList.add("dropping"); });
}
document.addEventListener("dragleave", (event) => { if (!event.relatedTarget) { composer.classList.remove("dropping"); document.querySelector(".drop-zone")?.classList.remove("dropping"); } });
document.addEventListener("drop", (event) => {
  event.preventDefault();
  composer.classList.remove("dropping");
  document.querySelector(".drop-zone")?.classList.remove("dropping");
  // Open on a collection, a drop goes into it, not into a memory.
  if (view === "collection") return void addToCollection({ files: [...(event.dataTransfer?.files ?? [])].map((file) => window.lore.pathFor(file)).filter(Boolean) });
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

/* New: one place to start anything the owner makes. */
const newOpen = /** @type {HTMLButtonElement} */ ($("#new-open"));
const newMenu = $("#new-menu");
function closeNewMenu() {
  newMenu.hidden = true;
  newOpen.setAttribute("aria-expanded", "false");
}
newOpen.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = newMenu.hidden;
  newMenu.hidden = !opening;
  newOpen.setAttribute("aria-expanded", String(opening));
  if (opening) /** @type {HTMLElement | null} */ (newMenu.querySelector("button"))?.focus();
});
for (const item of newMenu.querySelectorAll("button")) {
  item.addEventListener("click", () => {
    closeNewMenu();
    if (/** @type {HTMLElement} */ (item).dataset.new === "collection") void newCollection();
    else startCapture();
  });
}

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
    : (snapshot ? privateMemories(snapshot) : []).slice(0, 8).map((item) => paletteRow(el("b", "", item.title), el("span", "", [item.project_label, when(item.updated_at)].filter(Boolean).join(" · ")), "open", () => void openMemory(item.id)));
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
  peek.append(el("b", "", memory.title), el("span", "", [memory.project, when(memory.updated_at)].filter(Boolean).join(" · ")), el("p", "", text.slice(0, 400)));
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
feedbackBtn.addEventListener("click", openFeedbackDialog);
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
  if (event.key === "Escape" && accountMenuOpen) { accountMenuOpen = false; renderAccount(); }
  if (event.key === "Escape" && !newMenu.hidden) { closeNewMenu(); newOpen.focus(); }
  if (event.key === "Escape") hidePeek();
});
document.addEventListener("click", (event) => {
  if (accountMenuOpen && !account.contains(/** @type {Node} */ (event.target))) { accountMenuOpen = false; renderAccount(); }
  if (!newMenu.hidden && !newOpen.parentElement?.contains(/** @type {Node} */ (event.target))) closeNewMenu();
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

Object.assign(window, { __lore: { show, openTask, paste: openPasteSheet, preview: renderRequest, event: onEvent, signIn: () => { previewSignIn = true; auth = { credentials: [{ providerId: "anthropic", type: "oauth" }] }; enter(); } } });

function boot() {
  if (previewSignIn) return;
  window.lore.agentStatus().then((result) => { auth = result; enter(); }).catch(() => { auth = { credentials: [] }; enter(); });
}

boot();
