export interface DesktopGatewayStatus {
  apiUrl: string;
  managedByDesktop: boolean;
  packaged: boolean;
  codexCommand: string;
  claudeCommand: string;
}

export interface DesktopMcpInstallResult {
  ok: boolean;
  message: string;
}

declare global {
  interface Window {
    aiVpsDesktop?: {
      getStatus: () => Promise<DesktopGatewayStatus>;
      installMcp: (client: "codex" | "claude") => Promise<DesktopMcpInstallResult>;
      onOpenMcpSetup: (callback: () => void) => () => void;
    };
  }
}

export {};
