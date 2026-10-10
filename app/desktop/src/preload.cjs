const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("lore", {
  snapshot: () => ipcRenderer.invoke("snapshot:read"),
  retrySetup: () => ipcRenderer.invoke("setup:retry"),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  /** @param {{text: string, task: AgentTask, from?: AgentTask, memory?: number}} input */
  prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
  /** @param {AgentTask} task */
  history: (task) => ipcRenderer.invoke("agent:history", task),
  tasks: () => ipcRenderer.invoke("agent:tasks"),
  /** @param {AgentTask} task */
  restart: (task) => ipcRenderer.invoke("agent:restart", task),
  /** @param {{id: string, value: unknown}} response */
  respond: (response) => ipcRenderer.invoke("agent:respond", response),
  /** @param {{providerId: string, type: "oauth" | "api_key", secret?: string}} input */
  login: (input) => ipcRenderer.invoke("auth:login", input),
  /** @param {string} providerId */
  logout: (providerId) => ipcRenderer.invoke("auth:logout", providerId),
  /** @param {string} query */
  search: (query) => ipcRenderer.invoke("search:query", query),
  /** @param {number} id */
  memory: (id) => ipcRenderer.invoke("memory:read", id),
  /** @param {number} id @param {string} title */
  renameMemory: (id, title) => ipcRenderer.invoke("memory:rename", id, title),
  /** @param {number} id @param {string} content */
  editMemory: (id, content) => ipcRenderer.invoke("memory:edit", id, content),
  /** @param {{title: string, content: string}} input */
  pasteMemory: (input) => ipcRenderer.invoke("memory:paste", input),
  candidates: () => ipcRenderer.invoke("publication:candidates"),
  /** @param {{candidate: PublicationCandidate, store: {priceUsd: number, origin: string, test: boolean}}} input */
  preview: (input) => ipcRenderer.invoke("publication:preview", input),
  /** @param {{original: PublicationCandidate, candidate: PublicationCandidate, approve: boolean}} input */
  decide: (input) => ipcRenderer.invoke("publication:decide", input),
  extras: () => ipcRenderer.invoke("publication:extras"),
  /** @param {{original: PublicationExtras, extras: PublicationExtras, approve: boolean}} input */
  decideExtras: (input) => ipcRenderer.invoke("publication:decide-extras", input),
  /** @param {Array<{original: PublicationExtras, extras: PublicationExtras}>} decisions */
  approveExtras: (decisions) => ipcRenderer.invoke("publication:approve-extras", decisions),
  /** @param {number} id */
  revoke: (id) => ipcRenderer.invoke("publication:revoke", id),
  push: () => ipcRenderer.invoke("store:push"),
  schedule: () => ipcRenderer.invoke("schedule:install"),
  /** @param {number} amount */
  setPrice: (amount) => ipcRenderer.invoke("pricing:set", amount),
  /** @param {number} count */
  setFreeCopies: (count) => ipcRenderer.invoke("pricing:free-copies", count),
  /** Pasted text and files, each put on sale as its own piece. @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input */
  sellPieces: (input) => ipcRenderer.invoke("sell:pieces", input),
  /** @param {string} [title] */
  newCollection: (title) => ipcRenderer.invoke("collection:new", title),
  /** @param {number} id @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input */
  addToCollection: (id, input) => ipcRenderer.invoke("collection:add", id, input),
  /** @param {number} id @param {string} title */
  renameCollection: (id, title) => ipcRenderer.invoke("collection:rename", id, title),
  /** @param {number} id @param {number} amount */
  priceCollection: (id, amount) => ipcRenderer.invoke("collection:price", id, amount),
  /** @param {number} id @param {number} piece */
  removeFromCollection: (id, piece) => ipcRenderer.invoke("collection:remove", id, piece),
  /** @param {number} id */
  deleteCollection: (id) => ipcRenderer.invoke("collection:delete", id),
  /** @param {number | null} amount Null takes Lore's suggested price. */
  setFeed: (amount) => ipcRenderer.invoke("feed:set", amount),
  feedOff: () => ipcRenderer.invoke("feed:off"),
  revealHome: () => ipcRenderer.invoke("home:reveal"),
  sales: () => ipcRenderer.invoke("store:sales"),
  views: () => ipcRenderer.invoke("store:views"),
  /** @param {{title: string, email: string, description: string}} input */
  reportFeedback: (input) => ipcRenderer.invoke("feedback:report", input),
  /** @param {"list" | "delist"} action */
  listStore: (action) => ipcRenderer.invoke("listing:act", action),
  listingStatus: () => ipcRenderer.invoke("listing:status"),
  cardStatus: () => ipcRenderer.invoke("cards:status"),
  connectCards: () => ipcRenderer.invoke("cards:connect"),
  /** @param {string | null} account */
  switchCards: (account) => ipcRenderer.invoke("cards:switch", account),
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  pickFolder: () => ipcRenderer.invoke("folders:pick"),
  sourceCatalog: () => ipcRenderer.invoke("sources:catalog"),
  /** @param {string} app */
  sourceChoices: (app) => ipcRenderer.invoke("sources:choices", app),
  /** @param {{connector: string, locator: string, replace?: string}} input */
  connectSource: (input) => ipcRenderer.invoke("sources:connect", input),
  /** @param {string} app */
  signIn: (app) => ipcRenderer.invoke("sources:sign-in", app),
  cancelConnect: () => ipcRenderer.invoke("sources:cancel"),
  /** @param {string} name */
  readSource: (name) => ipcRenderer.invoke("sources:read", name),
  /** @param {string} name @param {boolean} keep */
  removeSource: (name, keep) => ipcRenderer.invoke("sources:remove", name, keep),
  openPrivacySettings: () => ipcRenderer.invoke("settings:privacy"),
  /** @param {File} file */
  pathFor: (file) => webUtils.getPathForFile(file),
  microphone: () => ipcRenderer.invoke("dictation:permission"),
  /** @param {ArrayBuffer} wav */
  transcribe: (wav) => ipcRenderer.invoke("dictation:transcribe", wav),
  /** @param {(event: AgentEvent) => void} listener */
  onAgentEvent: (listener) => {
    /** @param {import("electron").IpcRendererEvent} _event @param {AgentEvent} value */
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  }
});
