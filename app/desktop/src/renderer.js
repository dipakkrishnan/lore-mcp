const title = /** @type {HTMLHeadingElement} */ (document.querySelector("#title"));
const subtitle = /** @type {HTMLParagraphElement} */ (document.querySelector("#subtitle"));
const status = /** @type {HTMLDivElement} */ (document.querySelector("#status"));
const content = /** @type {HTMLDivElement} */ (document.querySelector("#content"));
const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("nav button")]);

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
  const live = snapshot.node.live.state === "online" ? "Live" : snapshot.node.live.state === "unreachable" ? "Offline" : "Not configured";
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
  const nodeState = snapshot.node.live.state === "online" ? "Online" : snapshot.node.live.state === "unreachable" ? "Offline" : "Not configured";
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
    ["Drafts", [], "Drafts are not tracked by Lore yet."],
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

for (const button of buttons) {
  button.addEventListener("click", () => {
    view = /** @type {View} */ (button.dataset.view || "today");
    render();
    title.focus();
  });
}

void load();
