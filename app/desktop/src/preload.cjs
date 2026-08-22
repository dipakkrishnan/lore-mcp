const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lore", {
  snapshot: () => ipcRenderer.invoke("snapshot:read"),
  agentStatus: () => ipcRenderer.invoke("agent:status"),
  /** @param {string} text */
  prompt: (text) => ipcRenderer.invoke("agent:prompt", text),
  /** @param {{id: string, value: unknown}} response */
  respond: (response) => ipcRenderer.invoke("agent:respond", response),
  /** @param {{providerId: string, type: "oauth" | "api_key", secret?: string}} input */
  login: (input) => ipcRenderer.invoke("auth:login", input),
  /** @param {(event: AgentEvent) => void} listener */
  onAgentEvent: (listener) => {
    /** @param {import("electron").IpcRendererEvent} _event @param {AgentEvent} value */
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  }
});
