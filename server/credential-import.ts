import { chmodSync, copyFileSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { defaultAllVpsSourcePaths } from "./all-vps.js";
import { CredentialStore, defaultCredentialDirectory } from "./credentials.js";
import { GatewayDatabase } from "./db.js";

const SUPPORTED_KEY_EXTENSIONS = new Set([".key", ".pem"]);

export type CredentialImportAction = "ready" | "imported" | "unchanged" | "missing" | "skipped";

export interface CredentialImportEntry {
  serverId: string;
  serverName: string;
  address: string;
  credentialRef: string | null;
  action: CredentialImportAction;
  reason: string;
}

export interface CredentialImportResult {
  sourceDirectory: string;
  credentialDirectory: string;
  dryRun: boolean;
  entries: CredentialImportEntry[];
  summary: Record<CredentialImportAction, number>;
}

export interface CredentialImportOptions {
  sourceDirectory?: string;
  credentialDirectory?: string;
  dryRun?: boolean;
}

function keyCandidates(sourceDirectory: string, address: string): string[] {
  return readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => SUPPORTED_KEY_EXTENSIONS.has(extname(name).toLowerCase()) && name.includes(address))
    .sort((left, right) => left.localeCompare(right));
}

function summary(entries: CredentialImportEntry[]): CredentialImportResult["summary"] {
  return {
    ready: entries.filter((entry) => entry.action === "ready").length,
    imported: entries.filter((entry) => entry.action === "imported").length,
    unchanged: entries.filter((entry) => entry.action === "unchanged").length,
    missing: entries.filter((entry) => entry.action === "missing").length,
    skipped: entries.filter((entry) => entry.action === "skipped").length
  };
}

/**
 * Imports only address-matched key files. The key bytes stay opaque to this process:
 * the filesystem copies the file and ssh reads it later when a session is active.
 */
export function importAllVpsCredentials(database: GatewayDatabase, options: CredentialImportOptions = {}): CredentialImportResult {
  const sourceDirectory = options.sourceDirectory ?? defaultAllVpsSourcePaths().directory;
  const credentialDirectory = options.credentialDirectory ?? defaultCredentialDirectory();
  const dryRun = options.dryRun ?? false;
  const store = new CredentialStore(credentialDirectory);
  const entries: CredentialImportEntry[] = [];

  for (const server of database.listServersBySource("all-vps")) {
    if (server.credentialRef) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef: server.credentialRef,
        action: "unchanged",
        reason: "已配置网关凭据引用，保留现有设置"
      });
      continue;
    }

    const candidates = keyCandidates(sourceDirectory, server.address);
    if (!candidates.length) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef: null,
        action: "missing",
        reason: "未找到名称包含该 VPS 地址的 .key 或 .pem 文件"
      });
      continue;
    }
    if (candidates.length > 1) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef: null,
        action: "skipped",
        reason: "匹配到多个候选凭据文件，拒绝猜测"
      });
      continue;
    }

    const credentialRef = candidates[0] as string;
    const sourcePath = join(sourceDirectory, credentialRef);
    const destinationPath = join(store.directory, credentialRef);
    const metadata = lstatSync(sourcePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef: null,
        action: "skipped",
        reason: "候选凭据不是普通文件"
      });
      continue;
    }
    if (existsSync(destinationPath)) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef: null,
        action: "skipped",
        reason: "网关凭据目录已有同名文件，未覆盖"
      });
      continue;
    }

    if (dryRun) {
      entries.push({
        serverId: server.id,
        serverName: server.name,
        address: server.address,
        credentialRef,
        action: "ready",
        reason: "可安全导入"
      });
      continue;
    }

    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, 0o600);
    database.updateServer(server.id, { credentialRef });
    database.audit("credential.imported", "server", server.id, `导入网关凭据引用：${server.name}`, "warning", {
      credentialRef,
      source: "all-vps"
    });
    entries.push({
      serverId: server.id,
      serverName: server.name,
      address: server.address,
      credentialRef,
      action: "imported",
      reason: "已复制到网关私有凭据目录"
    });
  }

  return { sourceDirectory, credentialDirectory: store.directory, dryRun, entries, summary: summary(entries) };
}
