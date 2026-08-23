const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("lore", {
  snapshot: () => ipcRenderer.invoke("snapshot:read"),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  /** @param {{text: string, task: AgentTask}} input */
  prompt: (input) => ipcRenderer.invoke("agent:prompt", input),
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
  candidates: () => ipcRenderer.invoke("publication:candidates"),
  /** @param {{candidate: PublicationCandidate, approve: boolean}} input */
  decide: (input) => ipcRenderer.invoke("publication:decide", input),
  /** @param {number} id */
  revoke: (id) => ipcRenderer.invoke("publication:revoke", id),
  push: () => ipcRenderer.invoke("store:push"),
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  /** @param {File} file */
  pathFor: (file) => webUtils.getPathForFile(file),
  /** @param {(event: AgentEvent) => void} listener */
  onAgentEvent: (listener) => {
    /** @param {import("electron").IpcRendererEvent} _event @param {AgentEvent} value */
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  }
});
