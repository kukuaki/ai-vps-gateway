import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/main.js";

const API_PORT = 4318;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const MCP_CLIENTS = ["codex", "claude"] as const;

type McpClient = (typeof MCP_CLIENTS)[number];

interface CliResult {
  ok: boolean;
  message: string;
}

let mainWindow: BrowserWindow | null = null;
let gateway: FastifyInstance | null = null;
let tray: Tray | null = null;
let trayMenu: Menu | null = null;
let ownsGateway = false;
let isClosing = false;

function desktopPath(): string {
  return app.isPackaged ? join(process.resourcesPath, "web") : resolve(__dirname, "..", "dist");
}

function mcpBundlePath(): string {
  return app.isPackaged ? join(process.resourcesPath, "mcp.cjs") : join(__dirname, "mcp.cjs");
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "menubar-template.png")
    : resolve(__dirname, "..", "assets", "menubar-template.png");
}

function cliPath(): string {
  let fnmMultishellBins: string[] = [];
  try {
    const fnmRoot = join(homedir(), ".local", "state", "fnm_multishells");
    fnmMultishellBins = readdirSync(fnmRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(fnmRoot, entry.name, "bin"));
  } catch {
    fnmMultishellBins = [];
  }
  const candidates = [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(homedir(), ".local", "bin"),
    join(homedir(), ".npm", "bin"),
    join(homedir(), ".npm-global", "bin"),
    join(homedir(), ".bun", "bin"),
    join(homedir(), ".cargo", "bin"),
    "/Applications/ChatGPT.app/Contents/Resources",
    ...fnmMultishellBins
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)].join(":");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function mcpCommand(client: McpClient): string {
  const executable = shellQuote(process.execPath);
  return client === "codex"
    ? `codex mcp add ai-vps-gateway -- ${executable} --mcp`
    : `claude mcp add --scope user ai-vps-gateway -- ${executable} --mcp`;
}

async function gatewayAlreadyRunning(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  timeout.unref();
  try {
    const response = await fetch(`${API_ORIGIN}/api/health`, { signal: controller.signal });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; mode?: string } | null;
    if (!response.ok || payload?.ok !== true || payload.mode !== "local-only") return false;
    const webResponse = await fetch(`${API_ORIGIN}/`, { signal: controller.signal });
    return webResponse.ok && (webResponse.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startGateway(): Promise<void> {
  if (await gatewayAlreadyRunning()) {
    ownsGateway = false;
    return;
  }

  const candidate = await buildApp(undefined, { staticDirectory: desktopPath() });
  try {
    await candidate.listen({ host: "127.0.0.1", port: API_PORT });
    gateway = candidate;
    ownsGateway = true;
  } catch (error) {
    await candidate.close();
    if (await gatewayAlreadyRunning()) {
      ownsGateway = false;
      return;
    }
    throw error;
  }
}

async function stopGateway(): Promise<void> {
  if (!ownsGateway || !gateway) return;
  const runningGateway = gateway;
  gateway = null;
  ownsGateway = false;
  await runningGateway.close();
}

function showDashboard(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function openMcpSetup(): void {
  showDashboard();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sendRequest = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("desktop:open-mcp-setup");
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", sendRequest);
    return;
  }
  sendRequest();
}

function openDataDirectory(): void {
  const dataDirectory = process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "AI VPS Gateway")
    : join(homedir(), ".local", "share", "ai-vps-gateway");
  void shell.openPath(dataDirectory);
}

function showTrayMenu(): void {
  tray?.popUpContextMenu(trayMenu ?? undefined);
}

function createTray(): void {
  const sourceIcon = nativeImage.createFromPath(trayIconPath());
  if (sourceIcon.isEmpty()) throw new Error(`找不到 menubar 图标：${trayIconPath()}`);
  const icon = sourceIcon.resize({ width: 16, height: 16 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("AI VPS Gateway");
  tray.setIgnoreDoubleClickEvents(true);
  trayMenu = Menu.buildFromTemplate([
    { label: "AI VPS Gateway", enabled: false },
    { type: "separator" },
    { label: "打开仪表盘", click: showDashboard },
    { label: "MCP 设置", click: openMcpSetup },
    { label: "打开数据目录", click: openDataDirectory },
    { type: "separator" },
    { label: ownsGateway ? "本地网关运行中" : "复用现有本机网关", enabled: false },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  tray.on("click", showTrayMenu);
  tray.on("right-click", showTrayMenu);
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
  trayMenu = null;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: "AI VPS Gateway",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (isClosing) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(API_ORIGIN)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  void mainWindow.loadURL(`${API_ORIGIN}/`);
}

function runCli(command: string, args: string[]): Promise<CliResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    const append = (value: string, chunk: Buffer): string => {
      const next = value + chunk.toString("utf8");
      return next.length > 12_000 ? next.slice(0, 12_000) : next;
    };
    const child = spawn(command, args, {
      cwd: homedir(),
      env: { ...process.env, PATH: cliPath() },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      resolveResult({ ok: false, message: `无法启动 ${command}：${error.message}` });
    });
    child.once("close", (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      if (code === 0) {
        resolveResult({ ok: true, message: output || `${command} MCP 已配置` });
        return;
      }
      resolveResult({ ok: false, message: output || `${command} 退出码：${code ?? "unknown"}` });
    });
  });
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-status", () => ({
    apiUrl: API_ORIGIN,
    managedByDesktop: ownsGateway,
    packaged: app.isPackaged,
    codexCommand: mcpCommand("codex"),
    claudeCommand: mcpCommand("claude")
  }));

  ipcMain.handle("desktop:install-mcp", async (_event, client: unknown): Promise<CliResult> => {
    if (!MCP_CLIENTS.includes(client as McpClient)) {
      return { ok: false, message: "未知 MCP 客户端" };
    }
    if (!app.isPackaged) {
      return { ok: false, message: "请使用已打包的桌面应用安装 MCP 配置" };
    }
    const selectedClient = client as McpClient;
    const args = selectedClient === "codex"
      ? ["mcp", "add", "ai-vps-gateway", "--", process.execPath, "--mcp"]
      : ["mcp", "add", "--scope", "user", "ai-vps-gateway", "--", process.execPath, "--mcp"];
    return runCli(selectedClient, args);
  });
}

async function startMcpMode(): Promise<void> {
  process.stdin.once("end", () => app.exit(0));
  process.stdin.once("close", () => app.exit(0));
  await app.whenReady();
  if (process.platform === "darwin") app.dock?.hide();
  await import(pathToFileURL(mcpBundlePath()).href);
}

async function bootstrapDesktop(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    showDashboard();
  });
  await app.whenReady();
  registerIpc();
  try {
    await startGateway();
    createWindow();
    createTray();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("AI VPS Gateway 无法启动", `本机端口 ${API_PORT} 无法提供网关服务。\n\n${message}`);
    app.quit();
    return;
  }

  app.on("activate", () => {
    if (!mainWindow) createWindow();
    showDashboard();
  });
  app.on("window-all-closed", () => {
    // The gateway remains available from the menubar while its window is hidden.
  });
  app.on("before-quit", (event) => {
    if (isClosing || !ownsGateway || !gateway) return;
    event.preventDefault();
    isClosing = true;
    void stopGateway().finally(() => app.quit());
  });
  app.on("will-quit", destroyTray);
}

if (process.argv.includes("--mcp")) {
  void startMcpMode().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
} else {
  void bootstrapDesktop();
}
