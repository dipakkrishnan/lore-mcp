const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lore", {
  snapshot: () => ipcRenderer.invoke("snapshot:read")
});
