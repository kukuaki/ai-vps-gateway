import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditEvent,
  AuditSeverity,
  CreateServerInput,
  DashboardSummary,
  HealthCheck,
  MetricSnapshot,
  ProbeResult,
  ServerRecord,
  ServerStatus,
  UpdateServerInput
} from "./types.js";

interface RawServer {
  id: string;
  name: string;
  address: string;
  ssh_port: number;
  ssh_user: string;
  credential_ref: string | null;
  role: string;
  environment: string;
  access_url: string | null;
  tags_json: string;
  maintenance: number;
  status: ServerStatus;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface RawHealthCheck {
  id: string;
  server_id: string;
  name: string;
  kind: HealthCheck["kind"];
  enabled: number;
  config_json: string;
}

interface RawAuditEvent {
  id: string;
  created_at: string;
  action: string;
  target_type: string;
  target_id: string | null;
  severity: AuditSeverity;
  summary: string;
  metadata_json: string;
}

interface RawMetric {
  server_id: string;
  collected_at: string;
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_percent: number | null;
  load1: number | null;
  source: MetricSnapshot["source"];
  note: string | null;
}

export function defaultDataDirectory(): string {
  if (process.env.ALLVPS_DATA_DIR) {
    return process.env.ALLVPS_DATA_DIR;
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "AI VPS Gateway");
  }

  return join(homedir(), ".local", "share", "ai-vps-gateway");
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function now(): string {
  return new Date().toISOString();
}

function toServer(raw: RawServer, healthChecks: HealthCheck[]): ServerRecord {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    sshPort: raw.ssh_port,
    sshUser: raw.ssh_user,
    credentialRef: raw.credential_ref,
    role: raw.role,
    environment: raw.environment,
    accessUrl: raw.access_url,
    tags: parseJson<string[]>(raw.tags_json, []),
    maintenance: raw.maintenance === 1,
    status: raw.status,
    lastCheckedAt: raw.last_checked_at,
    lastError: raw.last_error,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    healthChecks
  };
}

export class GatewayDatabase {
  readonly dataDirectory: string;
  readonly databasePath: string;
  private readonly db: DatabaseSync;

  constructor(dataDirectory = defaultDataDirectory()) {
    this.dataDirectory = dataDirectory;
    this.databasePath = join(dataDirectory, "gateway.sqlite");
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.databasePath);
    chmodSync(this.databasePath, 0o600);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        ssh_port INTEGER NOT NULL,
        ssh_user TEXT NOT NULL,
        credential_ref TEXT,
        role TEXT NOT NULL DEFAULT '',
        environment TEXT NOT NULL DEFAULT 'production',
        access_url TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        maintenance INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_checks (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS health_events (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL,
        results_json TEXT NOT NULL,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        collected_at TEXT NOT NULL,
        cpu_percent REAL,
        memory_percent REAL,
        disk_percent REAL,
        load1 REAL,
        source TEXT NOT NULL,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_health_events_server_time
        ON health_events(server_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_time
        ON audit_events(created_at DESC);
    `);

    try {
      this.db.exec("ALTER TABLE servers ADD COLUMN archived_at TEXT");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  private healthChecksFor(serverId: string): HealthCheck[] {
    const rows = this.db
      .prepare("SELECT * FROM health_checks WHERE server_id = ? ORDER BY name COLLATE NOCASE")
      .all(serverId) as unknown as RawHealthCheck[];

    return rows.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      kind: row.kind,
      enabled: row.enabled === 1,
      config: parseJson(row.config_json, {})
    }));
  }

  private rawServer(serverId: string, includeArchived = false): RawServer | null {
    const query = includeArchived
      ? "SELECT * FROM servers WHERE id = ?"
      : "SELECT * FROM servers WHERE id = ? AND archived_at IS NULL";

    return (this.db.prepare(query).get(serverId) as unknown as RawServer | undefined) ?? null;
  }

  listServers(includeArchived = false): ServerRecord[] {
    const query = includeArchived
      ? "SELECT * FROM servers ORDER BY CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END, name COLLATE NOCASE"
      : "SELECT * FROM servers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE";
    const rows = this.db.prepare(query).all() as unknown as RawServer[];
    return rows.map((row) => toServer(row, this.healthChecksFor(row.id)));
  }

  getServer(serverId: string, includeArchived = false): ServerRecord | null {
    const raw = this.rawServer(serverId, includeArchived);
    return raw ? toServer(raw, this.healthChecksFor(raw.id)) : null;
  }

  createServer(input: CreateServerInput): ServerRecord {
    const id = randomUUID();
    const timestamp = now();
    this.db
      .prepare(`
        INSERT INTO servers
          (id, name, address, ssh_port, ssh_user, credential_ref, role, environment,
           access_url, tags_json, maintenance, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
      `)
      .run(
        id,
        input.name,
        input.address,
        input.sshPort,
        input.sshUser,
        input.credentialRef ?? null,
        input.role ?? "",
        input.environment ?? "production",
        input.accessUrl ?? null,
        JSON.stringify(input.tags ?? []),
        input.maintenance ? 1 : 0,
        timestamp,
        timestamp
      );
    this.replaceHealthChecks(id, input.healthChecks ?? []);
    return this.getServer(id) as ServerRecord;
  }

  updateServer(serverId: string, patch: UpdateServerInput): ServerRecord | null {
    const existing = this.getServer(serverId);
    if (!existing) return null;
    const next = {
      name: patch.name ?? existing.name,
      address: patch.address ?? existing.address,
      sshPort: patch.sshPort ?? existing.sshPort,
      sshUser: patch.sshUser ?? existing.sshUser,
      credentialRef: patch.credentialRef === undefined ? existing.credentialRef : patch.credentialRef,
      role: patch.role ?? existing.role,
      environment: patch.environment ?? existing.environment,
      accessUrl: patch.accessUrl === undefined ? existing.accessUrl : patch.accessUrl,
      tags: patch.tags ?? existing.tags,
      maintenance: patch.maintenance ?? existing.maintenance
    };
    const timestamp = now();
    this.db
      .prepare(`
        UPDATE servers SET name = ?, address = ?, ssh_port = ?, ssh_user = ?,
          credential_ref = ?, role = ?, environment = ?, access_url = ?, tags_json = ?,
          maintenance = ?, updated_at = ? WHERE id = ?
      `)
      .run(
        next.name,
        next.address,
        next.sshPort,
        next.sshUser,
        next.credentialRef ?? null,
        next.role,
        next.environment,
        next.accessUrl ?? null,
        JSON.stringify(next.tags),
        next.maintenance ? 1 : 0,
        timestamp,
        serverId
      );
    if (patch.healthChecks !== undefined) {
      this.replaceHealthChecks(serverId, patch.healthChecks);
    }
    return this.getServer(serverId);
  }

  archiveServer(serverId: string): boolean {
    const timestamp = now();
    const result = this.db
      .prepare("UPDATE servers SET archived_at = ?, status = 'archived', updated_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(timestamp, timestamp, serverId);
    return result.changes > 0;
  }

  replaceHealthChecks(
    serverId: string,
    checks: Array<{ name: string; kind: HealthCheck["kind"]; enabled?: boolean; config: HealthCheck["config"] }>
  ): void {
    this.db.prepare("DELETE FROM health_checks WHERE server_id = ?").run(serverId);
    const insert = this.db.prepare(
      "INSERT INTO health_checks (id, server_id, name, kind, enabled, config_json) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const check of checks) {
      insert.run(randomUUID(), serverId, check.name, check.kind, check.enabled === false ? 0 : 1, JSON.stringify(check.config));
    }
  }

  updateProbe(serverId: string, status: ServerStatus, checkedAt: string, error: string | null): void {
    this.db
      .prepare("UPDATE servers SET status = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .run(status, checkedAt, error, checkedAt, serverId);
  }

  addHealthEvent(serverId: string, checkedAt: string, status: ServerStatus, results: ProbeResult[], error: string | null): void {
    this.db
      .prepare("INSERT INTO health_events (id, server_id, checked_at, status, results_json, error) VALUES (?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), serverId, checkedAt, status, JSON.stringify(results), error);
  }

  recentHealthEvents(serverId: string, limit = 20): Array<{ id: string; checkedAt: string; status: ServerStatus; results: ProbeResult[]; error: string | null }> {
    const rows = this.db
      .prepare("SELECT id, checked_at, status, results_json, error FROM health_events WHERE server_id = ? ORDER BY checked_at DESC LIMIT ?")
      .all(serverId, Math.min(Math.max(limit, 1), 100)) as unknown as Array<{
      id: string;
      checked_at: string;
      status: ServerStatus;
      results_json: string;
      error: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      checkedAt: row.checked_at,
      status: row.status,
      results: parseJson<ProbeResult[]>(row.results_json, []),
      error: row.error
    }));
  }

  saveMetric(metric: MetricSnapshot): void {
    this.db
      .prepare(`
        INSERT INTO metrics (id, server_id, collected_at, cpu_percent, memory_percent, disk_percent, load1, source, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        metric.serverId,
        metric.collectedAt,
        metric.cpuPercent,
        metric.memoryPercent,
        metric.diskPercent,
        metric.load1,
        metric.source,
        metric.note
      );
  }

  latestMetric(serverId: string): MetricSnapshot | null {
    const row = this.db
      .prepare("SELECT server_id, collected_at, cpu_percent, memory_percent, disk_percent, load1, source, note FROM metrics WHERE server_id = ? ORDER BY collected_at DESC LIMIT 1")
      .get(serverId) as unknown as RawMetric | undefined;
    if (!row) return null;
    return {
      serverId: row.server_id,
      collectedAt: row.collected_at,
      cpuPercent: row.cpu_percent,
      memoryPercent: row.memory_percent,
      diskPercent: row.disk_percent,
      load1: row.load1,
      source: row.source,
      note: row.note
    };
  }

  audit(
    action: string,
    targetType: string,
    targetId: string | null,
    summary: string,
    severity: AuditSeverity = "info",
    metadata: Record<string, unknown> = {}
  ): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      createdAt: now(),
      action,
      targetType,
      targetId,
      severity,
      summary,
      metadata
    };
    this.db
      .prepare("INSERT INTO audit_events (id, created_at, action, target_type, target_id, severity, summary, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.createdAt, action, targetType, targetId, severity, summary, JSON.stringify(metadata));
    return event;
  }

  recentAudit(limit = 50): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(Math.max(limit, 1), 200)) as unknown as RawAuditEvent[];
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      severity: row.severity,
      summary: row.summary,
      metadata: parseJson<Record<string, unknown>>(row.metadata_json, {})
    }));
  }

  dashboard(): { summary: DashboardSummary; servers: ServerRecord[] } {
    const servers = this.listServers();
    const summary: DashboardSummary = {
      total: servers.length,
      healthy: servers.filter((server) => server.status === "healthy").length,
      degraded: servers.filter((server) => server.status === "degraded").length,
      unreachable: servers.filter((server) => ["offline", "ssh_unreachable"].includes(server.status)).length,
      unknown: servers.filter((server) => server.status === "unknown").length,
      lastUpdatedAt: servers.reduce<string | null>((latest, server) => {
        if (!server.lastCheckedAt) return latest;
        return !latest || server.lastCheckedAt > latest ? server.lastCheckedAt : latest;
      }, null)
    };
    return { summary, servers };
  }

  close(): void {
    this.db.close();
  }
}
