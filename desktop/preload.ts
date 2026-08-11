import { contextBridge, ipcRenderer } from "electron";

type McpClient = "codex" | "claude";

contextBridge.exposeInMainWorld("aiVpsDesktop", {
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  installMcp: (client: McpClient) => ipcRenderer.invoke("desktop:install-mcp", client),
  onOpenMcpSetup: (callback: () => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("desktop:open-mcp-setup", listener);
    return () => ipcRenderer.removeListener("desktop:open-mcp-setup", listener);
  }
});
