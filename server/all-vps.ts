import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { GatewayDatabase } from "./db.js";
import type { CreateServerInput, ImportedServerInput, ImportSyncPreview, ImportSyncResult } from "./types.js";

interface MarkdownTable {
  headers: string[];
  rows: string[][];
}

export interface AllVpsSourcePaths {
  directory: string;
  inventoryPath: string;
  domainsPath: string;
}

export interface AllVpsSourceInfo {
  inventoryFile: string;
  domainsFile: string;
  digest: string;
}

export interface AllVpsDocument {
  source: AllVpsSourceInfo;
  paths: AllVpsSourcePaths;
  assets: ImportedServerInput[];
  warnings: string[];
}

export interface AllVpsSyncPreview {
  source: AllVpsSourceInfo;
  changes: ImportSyncPreview[];
  stale: Array<{ id: string; name: string; sourceKey: string }>;
  warnings: string[];
  summary: { created: number; updated: number; unchanged: number; stale: number };
}

export interface AllVpsSyncResult extends Omit<AllVpsSyncPreview, "changes" | "summary"> {
  changes: ImportSyncResult[];
  summary: { created: number; updated: number; unchanged: number; stale: number };
}

function cleanCell(value: string): string {
  return value
    .trim()
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed.slice(1, -1).split("|").map(cleanCell);
}

function isSeparatorRow(line: string): boolean {
  return /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(line.trim());
}

function markdownTables(markdown: string): MarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: MarkdownTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith("|") || !isSeparatorRow(lines[index + 1])) continue;
    const headers = tableCells(lines[index]);
    const rows: string[][] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].trim().startsWith("|")) {
      const cells = tableCells(lines[rowIndex]);
      if (cells.length === headers.length) rows.push(cells);
      rowIndex += 1;
    }
    tables.push({ headers, rows });
    index = rowIndex - 1;
  }
  return tables;
}

function requiredTable(tables: MarkdownTable[], headers: string[]): MarkdownTable {
  const table = tables.find((candidate) => headers.every((header) => candidate.headers.includes(header)));
  if (!table) {
    throw new Error(`未找到必需的 Markdown 表格列：${headers.join("、")}`);
  }
  return table;
}

function column(table: MarkdownTable, name: string): number {
  const index = table.headers.indexOf(name);
  if (index === -1) throw new Error(`缺少 Markdown 列：${name}`);
  return index;
}

function truncate(value: string, length: number): string {
  const characters = Array.from(value);
  return characters.length <= length ? value : `${characters.slice(0, Math.max(1, length - 1)).join("")}…`;
}

function parseSshTarget(value: string): { sshUser: string; address: string; sshPort: number } {
  const match = /^([A-Za-z_][A-Za-z0-9_-]{0,31})@([^\s:@]+):(\d{1,5})$/.exec(cleanCell(value));
  if (!match) throw new Error(`无法解析 SSH 地址：${value}`);
  const sshPort = Number(match[3]);
  if (sshPort < 1 || sshPort > 65535) throw new Error(`SSH 端口无效：${value}`);
  return { sshUser: match[1], address: match[2], sshPort };
}

function tagsFor(description: string): string[] {
  const lower = description.toLowerCase();
  const tags = ["all-vps"];
  const terms: Array<[string, string]> = [
    ["docker", "docker"],
    ["nginx", "nginx"],
    ["postgresql", "postgres"],
    ["s-ui", "s-ui"],
    ["sing-box", "sing-box"],
    ["竞赛", "contest"],
    ["支付", "payment"],
    ["zongde", "zongde"]
  ];
  for (const [needle, tag] of terms) {
    if (lower.includes(needle)) tags.push(tag);
  }
  return tags;
}

function isConcreteHostname(value: string): boolean {
  if (/NN|YYYY|\*/i.test(value)) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function statusCodesFromRow(row: string[]): number[] {
  const codes = new Set<number>();
  for (const value of row) {
    for (const match of value.matchAll(/(?:返回|响应)\s*([1-5]\d{2})/g)) {
      codes.add(Number(match[1]));
    }
  }
  return codes.size ? [...codes].sort((left, right) => left - right) : [200];
}

function healthChecksFor(domainsMarkdown: string, address: string): NonNullable<CreateServerInput["healthChecks"]> {
  const checks = new Map<string, NonNullable<CreateServerInput["healthChecks"]>[number]>();
  for (const table of markdownTables(domainsMarkdown)) {
    const hostnameColumn = table.headers.findIndex((header) => header.startsWith("主机名"));
    const originColumn = table.headers.findIndex((header) => header === "已确认源站" || header === "当前源站");
    if (hostnameColumn === -1 || originColumn === -1) continue;
    for (const row of table.rows) {
      const hostname = row[hostnameColumn];
      if (!row[originColumn].includes(address) || !isConcreteHostname(hostname)) continue;
      const expectedStatusCodes = statusCodesFromRow(row);
      const url = `https://${hostname}`;
      checks.set(url, {
        name: truncate(`HTTPS ${hostname}`, 80),
        kind: "http",
        enabled: true,
        config: { url, expectedStatusCodes }
      });
    }
  }
  return [...checks.values()];
}

function sourceDigest(inventoryMarkdown: string, domainsMarkdown: string): string {
  return createHash("sha256").update(inventoryMarkdown).update("\u0000").update(domainsMarkdown).digest("hex");
}

function readDocument(path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`${label}不存在：${path}`);
  return readFileSync(path, "utf8");
}

export function defaultAllVpsSourcePaths(directory = process.env.ALLVPS_SOURCE_DIR ?? join(homedir(), "Desktop", "all-vps")): AllVpsSourcePaths {
  return {
    directory,
    inventoryPath: join(directory, "VPS_INVENTORY.md"),
    domainsPath: join(directory, "DOMAINS.md")
  };
}

export function parseAllVpsDocuments(
  inventoryMarkdown: string,
  domainsMarkdown: string,
  paths: AllVpsSourcePaths = defaultAllVpsSourcePaths()
): AllVpsDocument {
  const table = requiredTable(markdownTables(inventoryMarkdown), ["节点", "SSH", "主要运行内容"]);
  const nameColumn = column(table, "节点");
  const sshColumn = column(table, "SSH");
  const roleColumn = column(table, "主要运行内容");
  const warnings: string[] = [];
  const seenSourceKeys = new Set<string>();
  const assets = table.rows.map((row) => {
    const name = row[nameColumn];
    const ssh = parseSshTarget(row[sshColumn]);
    const sourceKey = `all-vps:${ssh.address}:${ssh.sshPort}`;
    if (seenSourceKeys.has(sourceKey)) throw new Error(`发现重复的 SSH 资产：${sourceKey}`);
    seenSourceKeys.add(sourceKey);

    const healthChecks = healthChecksFor(domainsMarkdown, ssh.address);
    if (!healthChecks.length) warnings.push(`${name} 未在 DOMAINS.md 中找到可用于 HTTP 健康检查的固定域名`);
    const role = truncate(row[roleColumn], 100);
    const input: CreateServerInput = {
      name,
      address: ssh.address,
      sshPort: ssh.sshPort,
      sshUser: ssh.sshUser,
      role,
      environment: "production",
      accessUrl: healthChecks[0]?.config.url ?? null,
      tags: tagsFor(role),
      maintenance: false,
      healthChecks
    };
    return { source: "all-vps" as const, sourceKey, input };
  });

  if (!assets.length) throw new Error("VPS_INVENTORY.md 的总览表没有可同步的资产");
  return {
    source: {
      inventoryFile: basename(paths.inventoryPath),
      domainsFile: basename(paths.domainsPath),
      digest: sourceDigest(inventoryMarkdown, domainsMarkdown)
    },
    paths,
    assets,
    warnings
  };
}

export function loadAllVpsDocument(paths = defaultAllVpsSourcePaths()): AllVpsDocument {
  return parseAllVpsDocuments(
    readDocument(paths.inventoryPath, "VPS_INVENTORY.md"),
    readDocument(paths.domainsPath, "DOMAINS.md"),
    paths
  );
}

function summarize(changes: Array<Pick<ImportSyncPreview, "action">>, stale: number): AllVpsSyncPreview["summary"] {
  return {
    created: changes.filter((change) => change.action === "created").length,
    updated: changes.filter((change) => change.action === "updated").length,
    unchanged: changes.filter((change) => change.action === "unchanged").length,
    stale
  };
}

export function previewAllVpsSync(database: GatewayDatabase, document = loadAllVpsDocument()): AllVpsSyncPreview {
  const changes = document.assets.map((asset) => database.previewImportedServer(asset));
  const activeSourceKeys = new Set(document.assets.map((asset) => asset.sourceKey));
  const stale = database
    .listServersBySource("all-vps")
    .filter((server) => server.sourceKey && !activeSourceKeys.has(server.sourceKey))
    .map((server) => ({ id: server.id, name: server.name, sourceKey: server.sourceKey as string }));
  return {
    source: document.source,
    changes,
    stale,
    warnings: document.warnings,
    summary: summarize(changes, stale.length)
  };
}

export function applyAllVpsSync(database: GatewayDatabase, document = loadAllVpsDocument()): AllVpsSyncResult {
  const preview = previewAllVpsSync(database, document);
  const changes = document.assets.map((asset) => database.syncImportedServer(asset));
  return {
    ...preview,
    changes,
    summary: summarize(changes, preview.stale.length)
  };
}
