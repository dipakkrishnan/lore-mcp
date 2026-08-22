const title = /** @type {HTMLHeadingElement} */ (document.querySelector("#title"));
const subtitle = /** @type {HTMLParagraphElement} */ (document.querySelector("#subtitle"));
const status = /** @type {HTMLDivElement} */ (document.querySelector("#status"));
const content = /** @type {HTMLDivElement} */ (document.querySelector("#content"));
const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav button")]);
const captureForm = /** @type {HTMLFormElement} */ (document.querySelector("#capture-form"));
const captureInput = /** @type {HTMLTextAreaElement} */ (document.querySelector("#capture-input"));
const activity = /** @type {HTMLDivElement} */ (document.querySelector("#agent-activity"));
const request = /** @type {HTMLDivElement} */ (document.querySelector("#agent-request"));
const authStatus = /** @type {HTMLDivElement} */ (document.querySelector("#auth-status"));

/** @type {Snapshot | null} */
let state = null;
/** @typedef {"today" | "lore" | "store"} View */
/** @type {View} */
let view = "today";

/** @type {Record<View, [string, string]>} */
const copy = {
  today: ["Today", "A clear view of your Lore."],
  lore: ["My Lore", "What is private, published, or needs your attention."],
  store: ["Store", "What buyers can see and what your node charges."]
};

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[K]}
 */
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** @param {number | null} value */
function money(value) {
  return typeof value === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value)
    : "Not set";
}

function nodeLabel(state = "not_configured") {
  return state === "online" ? "Online" : state === "unreachable" ? "Offline" : "Not configured";
}

/**
 * @param {string} label
 * @param {string | number} value
 * @param {string} [note]
 */
function metric(label, value, note) {
  const node = element("div", "metric");
  node.append(element("span", "label", label), element("strong", "", String(value)));
  if (note) node.append(element("p", "", note));
  return node;
}

/** @param {...HTMLElement} children */
function grid(...children) {
  const node = element("div", "grid");
  node.append(...children);
  return node;
}

/**
 * @param {string} heading
 * @param {string} [intro]
 */
function panel(heading, intro = "") {
  const node = element("section", "panel");
  node.append(element("h2", "", heading));
  if (intro) node.append(element("p", "panel-intro", intro));
  return node;
}

/**
 * @param {Array<{title: string, project?: string, topic?: string}>} items
 * @param {string} emptyText
 */
function inventory(items, emptyText) {
  if (!items.length) return element("p", "empty", emptyText);
  const list = element("ul", "items");
  for (const item of items) {
    const row = document.createElement("li");
    row.append(element("h3", "", item.title));
    row.append(element("span", "item-meta", item.project || item.topic || "Uncategorized"));
    list.append(row);
  }
  return list;
}

/** @param {Snapshot} snapshot */
function renderToday(snapshot) {
  const steps = [
    ["Import agent memories", snapshot.setup.sources_configured],
    ["Shape your Lore", snapshot.setup.blueprint_configured],
    ["Set synthesis preferences", snapshot.setup.profile_configured]
  ];
  const checklist = element("ul", "checklist");
  for (const [label, complete] of steps) {
    const row = document.createElement("li");
    row.append(element("span", "", String(label)));
    row.append(element("span", complete ? "" : "incomplete", complete ? "Complete" : "Not set up"));
    checklist.append(row);
  }
  const setup = panel("Setup", "Lore stays useful when these three foundations are in place.");
  setup.append(checklist);
  const live = nodeLabel(snapshot.node.live.state);
  return [
    grid(
      metric("Private memories", snapshot.library.counts.private, "Held only on this Mac"),
      metric("Approved publications", snapshot.publications.counts.active, "Owner-approved for buyers"),
      metric("Store status", live, snapshot.node.live.network || "No network connected")
    ),
    setup
  ];
}

/** @param {Snapshot} snapshot */
function renderLore(snapshot) {
  const privateItems = snapshot.library.items.filter((item) => item.status === "private");
  const published = snapshot.publications.items.filter(
    (item) => item.state === "approved" && !item.needs_review
  );
  const review = snapshot.publications.items.filter((item) => item.needs_review);
  const privatePanel = panel("Private", `${privateItems.length} memories remain local to you.`);
  privatePanel.append(inventory(privateItems, "No private memories yet."));
  const publishedPanel = panel("Published", "Bounded items you approved for buyers.");
  publishedPanel.append(inventory(published, "Nothing is published yet."));
  const reviewPanel = panel("Needs review", "Published items whose source memory changed.");
  reviewPanel.append(inventory(review, "Nothing needs review."));
  return [privatePanel, publishedPanel, reviewPanel];
}

/** @param {Snapshot} snapshot */
function renderStore(snapshot) {
  const publications = snapshot.publications.items;
  const liveItems = publications.filter((item) => item.state === "approved" && item.live === true);
  const pending = publications.filter((item) => item.state === "approved" && item.live === false);
  const unknown = publications.filter((item) => item.state === "approved" && item.live === null);
  const revoked = publications.filter((item) => item.state === "revoked");
  const nodeState = nodeLabel(snapshot.node.live.state);
  const summary = grid(
    metric("Publication price", money(snapshot.pricing.publication_usd), "Configured on this Mac"),
    metric("Live price", money(snapshot.node.live.publication_price_usd), "Verified from the node"),
    metric("Deployment", nodeState, snapshot.node.live.network || "No live network")
  );
  const node = panel("Node", snapshot.node.revocation_pending ? "A revoked item may still be live. Push again." : "Current deployment truth from the public node.");
  if (snapshot.node.url) {
    const link = element("a", "node-link", "Open node");
    link.href = snapshot.node.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    node.append(link);
  } else {
    node.append(element("p", "empty", "No node has been configured."));
  }
  /** @type {Array<[string, PublicationItem[], string]>} */
  const groups = [
    ["Live", liveItems, "No publications are confirmed live."],
    ["Approved, not live", pending, "No approved publications are waiting to go live."],
    ["Approved, live status unknown", unknown, "Live status is available."],
    ["Revoked", revoked, "No revoked publications."]
  ];
  const panels = groups.map(([heading, items, emptyText]) => {
    const section = panel(String(heading));
    section.append(inventory(items, emptyText));
    return section;
  });
  return [summary, node, ...panels];
}

/** @type {Record<View, (snapshot: Snapshot) => HTMLElement[]>} */
const renderers = { today: renderToday, lore: renderLore, store: renderStore };

function render() {
  const [heading, description] = copy[view];
  title.textContent = heading;
  subtitle.textContent = description;
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  if (!state) return;
  content.replaceChildren(...renderers[view](state));
}

async function load() {
  state = null;
  status.textContent = "Loading…";
  content.replaceChildren();
  try {
    state = await window.lore.snapshot();
    status.textContent = "";
    render();
  } catch {
    status.textContent = "";
    const error = element("section", "error");
    error.setAttribute("role", "alert");
    error.append(
      element("h2", "", "Lore could not load"),
      element("p", "", "Your data was not changed. Check that Lore is installed, then try again.")
    );
    const retry = element("button", "", "Try again");
    retry.type = "button";
    retry.addEventListener("click", load);
    error.append(retry);
    content.replaceChildren(error);
  }
}

/** @param {string} text */
function note(text) {
  activity.replaceChildren(element("p", "", text));
}

/** @param {AgentStatus} agent */
function renderAuth(agent) {
  authStatus.replaceChildren();
  if (agent.credentials.length) {
    authStatus.append(element("span", "signed-in", "Signed in"));
    return;
  }
  const claude = element("button", "quiet", "Sign in with Claude");
  const chatgpt = element("button", "quiet", "Sign in with ChatGPT");
  const key = element("button", "quiet", "Use API key");
  for (const button of [claude, chatgpt, key]) button.type = "button";
  claude.addEventListener("click", () => login("anthropic", "oauth"));
  chatgpt.addEventListener("click", () => login("openai-codex", "oauth"));
  key.addEventListener("click", renderKeyForm);
  authStatus.append(claude, chatgpt, key);
}

function renderKeyForm() {
  const form = element("form", "key-form");
  const provider = document.createElement("select");
  provider.setAttribute("aria-label", "API provider");
  for (const [value, label] of [["anthropic", "Anthropic"], ["openai", "OpenAI"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    provider.append(option);
  }
  const input = document.createElement("input");
  input.type = "password";
  input.required = true;
  input.autocomplete = "off";
  input.placeholder = "API key";
  input.setAttribute("aria-label", "API key");
  const submit = element("button", "quiet", "Save");
  submit.type = "submit";
  form.append(provider, input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const secret = input.value;
    input.value = "";
    await login(provider.value, "api_key", secret);
  });
  authStatus.replaceChildren(form);
  input.focus();
}

/** @param {string} providerId @param {"oauth" | "api_key"} type @param {string} [secret] */
async function login(providerId, type, secret) {
  note("Starting sign-in…");
  try {
    renderAuth(await window.lore.login({ providerId, type, secret }));
    request.replaceChildren();
    note("Sign-in complete.");
  } catch (error) {
    note(error instanceof Error ? error.message : "Sign-in failed.");
  }
}

/** @param {AgentRequest} event */
function renderRequest(event) {
  const form = element("form", "agent-card");
  if (event.type === "bash-approval") {
    note("Lore needs approval to save a private memory.");
    form.append(element("h3", "", "Save this private memory?"), element("pre", "", event.command));
    const approve = element("button", "", "Allow once");
    const deny = element("button", "secondary", "Deny");
    approve.type = deny.type = "button";
    approve.addEventListener("click", () => respond(event.id, true));
    deny.addEventListener("click", () => respond(event.id, false));
    form.append(approve, deny);
  } else if (event.type === "question") {
    form.append(element("h3", "", "Lore needs your input"));
    for (const [index, question] of event.questions.entries()) {
      const fieldset = document.createElement("fieldset");
      fieldset.dataset.question = question.question;
      fieldset.append(element("legend", "", question.question));
      for (const option of question.options) {
        const label = element("label", "choice");
        const input = document.createElement("input");
        input.type = question.multiSelect ? "checkbox" : "radio";
        input.name = `question-${index}`;
        input.value = option.label;
        label.append(input, document.createTextNode(`${option.label} — ${option.description}`));
        fieldset.append(label);
      }
      const other = document.createElement("input");
      other.type = "text";
      other.placeholder = "Or type your answer";
      other.className = "other-answer";
      fieldset.append(other);
      form.append(fieldset);
    }
    const submit = element("button", "", "Continue");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      /** @type {Record<string, string>} */
      const answers = {};
      for (const fieldset of form.querySelectorAll("fieldset")) {
        const selected = [...fieldset.querySelectorAll("input:checked")].map(
          (input) => /** @type {HTMLInputElement} */ (input).value
        );
        const other = /** @type {HTMLInputElement} */ (fieldset.querySelector(".other-answer"));
        const question = fieldset.dataset.question;
        if (question) answers[question] = other.value.trim() || selected.join(", ");
      }
      respond(event.id, answers);
    });
  } else if (event.type === "auth-prompt") {
    form.append(element("h3", "", event.prompt.message));
    let input;
    if (event.prompt.type === "select") {
      input = document.createElement("select");
      for (const option of event.prompt.options) {
        const item = document.createElement("option");
        item.value = option.id;
        item.textContent = option.label;
        input.append(item);
      }
    } else {
      input = document.createElement("input");
      input.type = event.prompt.type === "secret" ? "password" : "text";
      input.placeholder = event.prompt.placeholder || "";
    }
    const submit = element("button", "", "Continue");
    submit.type = "submit";
    form.append(input, submit);
    form.addEventListener("submit", (submitEvent) => {
      submitEvent.preventDefault();
      const value = input.value;
      input.value = "";
      respond(event.id, value);
    });
  }
  request.replaceChildren(form);
  /** @type {HTMLElement | null} */ (form.querySelector("button, input, select"))?.focus();
}

/** @param {string} id @param {unknown} value */
async function respond(id, value) {
  request.replaceChildren();
  await window.lore.respond({ id, value });
}

window.lore.onAgentEvent((event) => {
  if (event.type === "working") {
    captureInput.disabled = event.active;
    const submit = /** @type {HTMLButtonElement} */ (captureForm.querySelector("button"));
    submit.disabled = event.active;
    if (event.active) note("Lore is listening…");
  } else if (event.type === "tool") {
    note(
      event.active
        ? `${event.name} requested…`
        : event.failed
          ? `${event.name} did not run.`
          : `${event.name} finished.`
    );
  } else if (event.type === "message") {
    note(event.text);
  } else if (
    event.type === "bash-approval" ||
    event.type === "question" ||
    event.type === "auth-prompt"
  ) {
    renderRequest(event);
  } else if (event.type === "auth") {
    const detail = event.event;
    note(
      event.message ||
        (detail?.type === "device_code"
          ? `Open ${detail.verificationUri} and enter ${detail.userCode}.`
          : detail && "message" in detail
            ? detail.message
            : "Continue sign-in.")
    );
  }
});

captureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = captureInput.value.trim();
  if (!text) return;
  try {
    await window.lore.prompt(text);
    captureInput.value = "";
    await load();
  } catch (error) {
    note(error instanceof Error ? error.message : "Capture failed.");
  }
});

for (const button of buttons) {
  button.addEventListener("click", () => {
    view = /** @type {View} */ (button.dataset.view || "today");
    render();
    title.focus();
  });
}

void load();
window.lore.agentStatus().then(renderAuth).catch(() => note("Sign-in status is unavailable."));
