import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { redactText, sanitizeAuditMetadata } from "./command-policy.js";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditEvent,
  AuditSeverity,
  CommandOutcome,
  CommandRisk,
  CommandRunRecord,
  CreateProjectInput,
  CreateServerInput,
  DiscoveredProjectInput,
  DashboardSummary,
  HealthCheck,
  ImportedServerInput,
  ImportSyncPreview,
  ImportSyncResult,
  MetricSnapshot,
  InventorySyncAction,
  ProjectDetail,
  ProjectRecord,
  ProjectRunbook,
  ProjectServerInput,
  ProjectServerLink,
  ProjectService,
  ProjectServiceInput,
  ProjectWebEndpoint,
  ProbeResult,
  ServerInventory,
  ServerProjectReference,
  ServerRecord,
  ServerSource,
  ServerStatus,
  SessionDetail,
  SessionRecord,
  SessionStatus,
  ServiceManager,
  UpdateProjectInput,
  UpdateServerInput
} from "./types.js";

interface RawServer {
  id: string;
  source: string;
  source_key: string | null;
  source_synced_at: string | null;
  archived_at: string | null;
  name: string;
  address: string;
  ssh_port: number;
  ssh_user: string;
  network_mode: string;
  credential_ref: string | null;
  emergency_root_until: string | null;
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

interface RawInventory {
  server_id: string;
  collected_at: string;
  inventory_json: string;
}

interface RawSession {
  id: string;
  server_id: string;
  server_name: string;
  server_address: string;
  status: SessionStatus;
  requester: string;
  created_at: string;
  activated_at: string | null;
  last_activity_at: string | null;
  idle_expires_at: string | null;
  max_expires_at: string;
  closed_at: string | null;
  close_reason: string | null;
  capability_hash: string;
  operation_in_flight: number;
  queue_position: number;
  active_session_id: string | null;
}

interface RawCommandRun {
  id: string;
  session_id: string;
  server_id: string;
  created_at: string;
  finished_at: string | null;
  command_text: string;
  risk: CommandRisk;
  outcome: CommandOutcome;
  exit_code: number | null;
  stdout_text: string;
  stderr_text: string;
  output_truncated: number;
  duration_ms: number | null;
  error: string | null;
}

interface RawProject {
  id: string;
  source: string;
  source_key: string | null;
  source_synced_at: string | null;
  name: string;
  description: string;
  repository_url: string | null;
  repository_path: string | null;
  technology_stack_json: string;
  web_endpoints_json: string;
  runbook_json: string;
  inventory_baseline_json: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  server_count: number;
  service_count: number;
  critical_service_count: number;
}

interface RawServerProjectReference {
  id: string;
  name: string;
  source: string;
  archived_at: string | null;
}

interface RawProjectServer {
  server_id: string;
  role: string;
  server_name: string;
  address: string;
  ssh_port: number;
  status: ServerStatus;
}

interface RawProjectService {
  id: string;
  project_id: string;
  server_id: string;
  server_name: string;
  name: string;
  manager: ServiceManager;
  identifier: string;
  port: number | null;
  port_mappings_json: string;
  access_url: string | null;
  critical: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface InventoryProjectServiceSnapshot {
  serverId: string;
  name: string;
  manager: ServiceManager;
  identifier: string;
  port: number | null;
  portMappings: string[];
  accessUrl: string | null;
  critical: boolean;
  notes: string;
}

interface InventoryProjectBaseline {
  version: 1;
  name: string;
  description: string;
  repositoryPath: string | null;
  technologyStack: string[];
  webEndpoints: ProjectWebEndpoint[];
  runbook: ProjectRunbook;
  services: InventoryProjectServiceSnapshot[];
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

function timestampAfter(timestamp: string, durationMs: number): string {
  return new Date(Date.parse(timestamp) + durationMs).toISOString();
}

function toServer(raw: RawServer, healthChecks: HealthCheck[]): ServerRecord {
  return {
    id: raw.id,
    source: raw.source === "all-vps" ? "all-vps" : "manual",
    sourceKey: raw.source_key,
    sourceSyncedAt: raw.source_synced_at,
    archivedAt: raw.archived_at,
    name: raw.name,
    address: raw.address,
    sshPort: raw.ssh_port,
    sshUser: raw.ssh_user,
    networkMode: raw.network_mode === "direct" ? "direct" : "system",
    credentialRef: raw.credential_ref,
    emergencyRootUntil: raw.emergency_root_until,
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

function emptyRunbook(): ProjectRunbook {
  return { overview: "", deployment: "", verification: "", troubleshooting: "", guardrails: "" };
}

function normalizedStringList(values: string[] | undefined | null): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function comparableProjectServices(services: Array<ProjectService | ProjectServiceInput>): InventoryProjectServiceSnapshot[] {
  return services
    .map((service) => ({
      serverId: service.serverId,
      name: service.name,
      manager: service.manager,
      identifier: service.identifier,
      port: service.port ?? null,
      portMappings: normalizedStringList(service.portMappings),
      accessUrl: service.accessUrl ?? null,
      critical: Boolean(service.critical),
      notes: service.notes ?? ""
    }))
    .sort((left, right) =>
      Number(right.critical) - Number(left.critical) ||
      left.name.localeCompare(right.name) ||
      left.manager.localeCompare(right.manager) ||
      left.identifier.localeCompare(right.identifier)
    );
}

function projectServiceSnapshotKey(service: InventoryProjectServiceSnapshot): string {
  return `${service.serverId}\u0000${service.manager}\u0000${service.identifier}`;
}

function isLegacyInventoryService(service: InventoryProjectServiceSnapshot): boolean {
  return /来源：[^\n]+的只读 SSH 盘点/.test(service.notes);
}

function inventoryProjectBaseline(
  input: DiscoveredProjectInput,
  technologyStack: string[],
  webEndpoints: ProjectWebEndpoint[],
  services: ProjectServiceInput[]
): InventoryProjectBaseline {
  return {
    version: 1,
    name: input.name,
    description: input.description,
    repositoryPath: input.repositoryPath ?? null,
    technologyStack,
    webEndpoints,
    runbook: input.runbook,
    services: comparableProjectServices(services)
  };
}

function parseInventoryProjectBaseline(value: string | null): InventoryProjectBaseline | null {
  if (!value) return null;
  const baseline = parseJson<InventoryProjectBaseline | null>(value, null);
  return baseline?.version === 1 ? baseline : null;
}

function mergeInventoryRunbook(
  current: ProjectRunbook,
  previous: ProjectRunbook | null,
  discovered: ProjectRunbook
): ProjectRunbook {
  if (!previous) return current;
  return {
    overview: current.overview === previous.overview ? discovered.overview : current.overview,
    deployment: current.deployment === previous.deployment ? discovered.deployment : current.deployment,
    verification: current.verification === previous.verification ? discovered.verification : current.verification,
    troubleshooting: current.troubleshooting === previous.troubleshooting ? discovered.troubleshooting : current.troubleshooting,
    guardrails: current.guardrails === previous.guardrails ? discovered.guardrails : current.guardrails
  };
}

function mergeInventoryTechnologyStack(
  current: string[],
  previous: string[] | null,
  discovered: string[]
): string[] {
  if (!previous) return current;
  const currentSet = new Set(current);
  const previousSet = new Set(previous);
  const manualAdditions = current.filter((item) => !previousSet.has(item));
  const manualRemovals = new Set(previous.filter((item) => !currentSet.has(item)));
  return normalizedStringList([...discovered.filter((item) => !manualRemovals.has(item)), ...manualAdditions]);
}

function mergeInventoryServices(
  currentServices: ProjectService[],
  previousBaseline: InventoryProjectBaseline | null,
  discoveredServices: ProjectServiceInput[]
): ProjectServiceInput[] {
  const current = new Map(comparableProjectServices(currentServices).map((service) => [projectServiceSnapshotKey(service), service]));
  const previous = new Map((previousBaseline?.services ?? []).map((service) => [projectServiceSnapshotKey(service), service]));
  const discovered = comparableProjectServices(discoveredServices);
  const discoveredKeys = new Set(discovered.map(projectServiceSnapshotKey));
  const previousAutomaticKeys = previousBaseline
    ? new Set(previous.keys())
    : new Set([...current.values()].filter((service) => discoveredKeys.has(projectServiceSnapshotKey(service)) || isLegacyInventoryService(service)).map(projectServiceSnapshotKey));

  const merged = discovered.map((service) => {
    const key = projectServiceSnapshotKey(service);
    const currentService = current.get(key);
    const previousService = previous.get(key);
    return {
      ...service,
      critical: currentService
        ? previousService && currentService.critical === previousService.critical ? service.critical : currentService.critical
        : service.critical,
      notes: currentService
        ? previousService && currentService.notes === previousService.notes ? service.notes : currentService.notes
        : service.notes
    };
  });

  for (const service of current.values()) {
    const key = projectServiceSnapshotKey(service);
    if (!discoveredKeys.has(key) && !previousAutomaticKeys.has(key)) merged.push(service);
  }
  return comparableProjectServices(merged);
}

function normalizedWebEndpoints(values: ProjectWebEndpoint[] | undefined | null): ProjectWebEndpoint[] {
  const endpoints = (values ?? [])
    .map((endpoint) => ({
      label: endpoint.label.trim().slice(0, 120),
      url: endpoint.url.trim(),
      port: endpoint.port ?? null,
      serviceName: endpoint.serviceName?.trim() || null,
      notes: endpoint.notes.trim().slice(0, 1_000),
      source: (endpoint.source === "remote-inventory" ? "remote-inventory" : "manual") as ProjectWebEndpoint["source"]
    }))
    .filter((endpoint) => endpoint.url.length > 0);
  const deduplicated = new Map<string, ProjectWebEndpoint>();
  for (const endpoint of endpoints) {
    const key = `${endpoint.url}\u0000${endpoint.serviceName ?? ""}`;
    deduplicated.set(key, endpoint);
  }
  return [...deduplicated.values()].sort((left, right) => `${left.url}:${left.serviceName ?? ""}`.localeCompare(`${right.url}:${right.serviceName ?? ""}`));
}

function toRunbook(value: string): ProjectRunbook {
  const parsed = parseJson<Partial<ProjectRunbook>>(value, {});
  return {
    overview: parsed.overview ?? "",
    deployment: parsed.deployment ?? "",
    verification: parsed.verification ?? "",
    troubleshooting: parsed.troubleshooting ?? "",
    guardrails: parsed.guardrails ?? ""
  };
}

function toSession(raw: RawSession): SessionRecord {
  return {
    id: raw.id,
    serverId: raw.server_id,
    serverName: raw.server_name,
    serverAddress: raw.server_address,
    status: raw.status,
    requester: raw.requester,
    createdAt: raw.created_at,
    activatedAt: raw.activated_at,
    lastActivityAt: raw.last_activity_at,
    idleExpiresAt: raw.idle_expires_at,
    maxExpiresAt: raw.max_expires_at,
    closedAt: raw.closed_at,
    closeReason: raw.close_reason,
    queuePosition: raw.status === "queued" ? raw.queue_position : 0,
    activeSessionId: raw.status === "active" ? null : raw.active_session_id,
    operationInFlight: raw.operation_in_flight === 1
  };
}

function toCommandRun(raw: RawCommandRun): CommandRunRecord {
  return {
    id: raw.id,
    sessionId: raw.session_id,
    serverId: raw.server_id,
    createdAt: raw.created_at,
    finishedAt: raw.finished_at,
    command: raw.command_text,
    risk: raw.risk,
    outcome: raw.outcome,
    exitCode: raw.exit_code,
    stdout: raw.stdout_text,
    stderr: raw.stderr_text,
    outputTruncated: raw.output_truncated === 1,
    durationMs: raw.duration_ms,
    error: raw.error
  };
}

function toProject(raw: RawProject): ProjectRecord {
  return {
    id: raw.id,
    source: raw.source === "remote-inventory" ? "remote-inventory" : "manual",
    sourceKey: raw.source_key,
    sourceSyncedAt: raw.source_synced_at,
    name: raw.name,
    description: raw.description,
    repositoryUrl: raw.repository_url,
    repositoryPath: raw.repository_path,
    technologyStack: normalizedStringList(parseJson<string[]>(raw.technology_stack_json ?? "[]", [])),
    webEndpoints: normalizedWebEndpoints(parseJson<ProjectWebEndpoint[]>(raw.web_endpoints_json ?? "[]", [])),
    archivedAt: raw.archived_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    serverCount: raw.server_count,
    serviceCount: raw.service_count,
    criticalServiceCount: raw.critical_service_count
  };
}

function normalizedHealthChecks(
  checks: Array<{ name: string; kind: HealthCheck["kind"]; enabled?: boolean; config: HealthCheck["config"] }>
): string {
  return JSON.stringify(
    checks
      .map((check) => ({
        name: check.name,
        kind: check.kind,
        enabled: check.enabled !== false,
        config: {
          ...(check.config.url ? { url: check.config.url } : {}),
          ...(check.config.host ? { host: check.config.host } : {}),
          ...(check.config.port ? { port: check.config.port } : {}),
          ...(check.config.expectedStatusCodes?.length
            ? { expectedStatusCodes: [...check.config.expectedStatusCodes].sort((left, right) => left - right) }
            : {}),
          ...(check.config.timeoutMs ? { timeoutMs: check.config.timeoutMs } : {})
        }
      }))
      .sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`))
  );
}

function normalizedTags(tags: string[]): string {
  return JSON.stringify([...new Set(tags)].sort((left, right) => left.localeCompare(right)));
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
        source TEXT NOT NULL DEFAULT 'manual',
        source_key TEXT,
        source_synced_at TEXT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        ssh_port INTEGER NOT NULL,
        ssh_user TEXT NOT NULL,
        network_mode TEXT NOT NULL DEFAULT 'system',
        credential_ref TEXT,
        emergency_root_until TEXT,
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

      CREATE TABLE IF NOT EXISTS server_inventories (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        collected_at TEXT NOT NULL,
        inventory_json TEXT NOT NULL
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        requester TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        last_activity_at TEXT,
        idle_expires_at TEXT,
        max_expires_at TEXT NOT NULL,
        closed_at TEXT,
        close_reason TEXT,
        capability_hash TEXT NOT NULL DEFAULT '',
        operation_in_flight INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS command_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        command_text TEXT NOT NULL,
        risk TEXT NOT NULL,
        outcome TEXT NOT NULL,
        exit_code INTEGER,
        stdout_text TEXT NOT NULL DEFAULT '',
        stderr_text TEXT NOT NULL DEFAULT '',
        output_truncated INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'manual',
        source_key TEXT,
        source_synced_at TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        repository_url TEXT,
        repository_path TEXT,
        technology_stack_json TEXT NOT NULL DEFAULT '[]',
        web_endpoints_json TEXT NOT NULL DEFAULT '[]',
        runbook_json TEXT NOT NULL DEFAULT '{}',
        inventory_baseline_json TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_servers (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL REFERENCES servers(id),
        role TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (project_id, server_id)
      );

      CREATE TABLE IF NOT EXISTS project_services (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        server_id TEXT NOT NULL REFERENCES servers(id),
        name TEXT NOT NULL,
        manager TEXT NOT NULL,
        identifier TEXT NOT NULL,
        port INTEGER,
        port_mappings_json TEXT NOT NULL DEFAULT '[]',
        access_url TEXT,
        critical INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

    `);

    this.addServerColumnIfMissing("archived_at TEXT");
    this.addServerColumnIfMissing("source TEXT NOT NULL DEFAULT 'manual'");
    this.addServerColumnIfMissing("source_key TEXT");
    this.addServerColumnIfMissing("source_synced_at TEXT");
    this.addServerColumnIfMissing("emergency_root_until TEXT");
    this.addServerColumnIfMissing("network_mode TEXT NOT NULL DEFAULT 'system'");
    this.addProjectColumnIfMissing("source TEXT NOT NULL DEFAULT 'manual'");
    this.addProjectColumnIfMissing("source_key TEXT");
    this.addProjectColumnIfMissing("source_synced_at TEXT");
    this.addProjectColumnIfMissing("technology_stack_json TEXT NOT NULL DEFAULT '[]'");
    this.addProjectColumnIfMissing("web_endpoints_json TEXT NOT NULL DEFAULT '[]'");
    this.addProjectColumnIfMissing("inventory_baseline_json TEXT");
    this.addProjectServiceColumnIfMissing("port_mappings_json TEXT NOT NULL DEFAULT '[]'");
    this.addSessionColumnIfMissing("capability_hash TEXT NOT NULL DEFAULT ''");
    this.addSessionColumnIfMissing("operation_in_flight INTEGER NOT NULL DEFAULT 0");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_source_key
        ON servers(source_key) WHERE source_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_health_events_server_time
        ON health_events(server_id, checked_at DESC);
      CREATE INDEX IF NOT EXISTS idx_metrics_server_time
        ON metrics(server_id, collected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_server_inventories_time
        ON server_inventories(server_id, collected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_time
        ON audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_server_status
        ON sessions(server_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_activity
        ON sessions(status, last_activity_at, max_expires_at);
      CREATE INDEX IF NOT EXISTS idx_command_runs_session_time
        ON command_runs(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_active
        ON projects(archived_at, name COLLATE NOCASE);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_source_key
        ON projects(source, source_key) WHERE source_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_project_servers_server
        ON project_servers(server_id);
      CREATE INDEX IF NOT EXISTS idx_project_services_project
        ON project_services(project_id);
    `);
  }

  private addServerColumnIfMissing(definition: string): void {
    try {
      this.db.exec(`ALTER TABLE servers ADD COLUMN ${definition}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  private addProjectColumnIfMissing(definition: string): void {
    try {
      this.db.exec(`ALTER TABLE projects ADD COLUMN ${definition}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }

  private addSessionColumnIfMissing(definition: string): void {
    try {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN ${definition}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
    }
  }

  private addProjectServiceColumnIfMissing(definition: string): void {
    try {
      this.db.exec(`ALTER TABLE project_services ADD COLUMN ${definition}`);
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
          (id, source, source_key, source_synced_at, name, address, ssh_port, ssh_user, network_mode, credential_ref, role, environment,
           access_url, tags_json, maintenance, status, created_at, updated_at)
        VALUES (?, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
      `)
      .run(
        id,
        input.name,
        input.address,
        input.sshPort,
        input.sshUser,
        input.networkMode ?? "system",
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
      networkMode: patch.networkMode ?? existing.networkMode,
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
          network_mode = ?, credential_ref = ?, role = ?, environment = ?, access_url = ?, tags_json = ?,
          maintenance = ?, updated_at = ? WHERE id = ?
      `)
      .run(
        next.name,
        next.address,
        next.sshPort,
        next.sshUser,
        next.networkMode,
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

  private importedTarget(input: ImportedServerInput): ServerRecord | null {
    const bySourceKey = this.db
      .prepare("SELECT * FROM servers WHERE source_key = ?")
      .get(input.sourceKey) as unknown as RawServer | undefined;
    if (bySourceKey) return toServer(bySourceKey, this.healthChecksFor(bySourceKey.id));

    const sameConnection = this.db
      .prepare("SELECT * FROM servers WHERE archived_at IS NULL AND source_key IS NULL AND address = ? AND ssh_port = ?")
      .all(input.input.address, input.input.sshPort) as unknown as RawServer[];
    if (sameConnection.length !== 1) return null;
    return toServer(sameConnection[0], this.healthChecksFor(sameConnection[0].id));
  }

  previewImportedServer(input: ImportedServerInput): ImportSyncPreview {
    const existing = this.importedTarget(input);
    if (!existing) {
      return {
        action: "created",
        serverId: null,
        sourceKey: input.sourceKey,
        name: input.input.name,
        changes: ["新增资产"]
      };
    }

    const changes: string[] = [];
    const desired = input.input;
    if (existing.source !== input.source || existing.sourceKey !== input.sourceKey) changes.push("纳入 all-vps 同步管理");
    if (existing.archivedAt) changes.push("恢复已归档资产");
    if (existing.name !== desired.name) changes.push("名称");
    if (existing.address !== desired.address || existing.sshPort !== desired.sshPort || existing.sshUser !== desired.sshUser) changes.push("SSH 连接");
    if (existing.networkMode !== (desired.networkMode ?? "system")) changes.push("SSH 网络路径");
    if (existing.role !== (desired.role ?? "")) changes.push("用途 / 角色");
    if (existing.environment !== (desired.environment ?? "production")) changes.push("环境");
    if (existing.accessUrl !== (desired.accessUrl ?? null)) changes.push("访问地址");
    if (normalizedTags(existing.tags) !== normalizedTags(desired.tags ?? [])) changes.push("标签");
    if (normalizedHealthChecks(existing.healthChecks) !== normalizedHealthChecks(desired.healthChecks ?? [])) changes.push("健康检查");

    return {
      action: changes.length ? "updated" : "unchanged",
      serverId: existing.id,
      sourceKey: input.sourceKey,
      name: desired.name,
      changes
    };
  }

  syncImportedServer(input: ImportedServerInput): ImportSyncResult {
    const preview = this.previewImportedServer(input);
    const timestamp = now();
    const desired = input.input;
    const existing = preview.serverId ? this.getServer(preview.serverId, true) : null;

    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare(`
          INSERT INTO servers
            (id, source, source_key, source_synced_at, name, address, ssh_port, ssh_user, network_mode, credential_ref,
             role, environment, access_url, tags_json, maintenance, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'unknown', ?, ?)
        `)
        .run(
          id,
          input.source,
          input.sourceKey,
          timestamp,
          desired.name,
          desired.address,
          desired.sshPort,
          desired.sshUser,
          desired.networkMode ?? "system",
          desired.role ?? "",
          desired.environment ?? "production",
          desired.accessUrl ?? null,
          JSON.stringify(desired.tags ?? []),
          desired.maintenance ? 1 : 0,
          timestamp,
          timestamp
        );
      this.replaceHealthChecks(id, desired.healthChecks ?? []);
      return { ...preview, server: this.getServer(id) as ServerRecord };
    }

    if (preview.action === "unchanged") {
      this.db.prepare("UPDATE servers SET source_synced_at = ? WHERE id = ?").run(timestamp, existing.id);
      return { ...preview, server: this.getServer(existing.id, true) as ServerRecord };
    }

    this.db
      .prepare(`
        UPDATE servers SET source = ?, source_key = ?, source_synced_at = ?, name = ?, address = ?, ssh_port = ?,
          ssh_user = ?, network_mode = ?, role = ?, environment = ?, access_url = ?, tags_json = ?, archived_at = NULL,
          status = CASE WHEN archived_at IS NULL THEN status ELSE 'unknown' END, updated_at = ? WHERE id = ?
      `)
      .run(
        input.source,
        input.sourceKey,
        timestamp,
        desired.name,
        desired.address,
        desired.sshPort,
        desired.sshUser,
        desired.networkMode ?? "system",
        desired.role ?? "",
        desired.environment ?? "production",
        desired.accessUrl ?? null,
        JSON.stringify(desired.tags ?? []),
        timestamp,
        existing.id
      );
    if (preview.changes.includes("健康检查")) {
      this.replaceHealthChecks(existing.id, desired.healthChecks ?? []);
    }
    return { ...preview, server: this.getServer(existing.id) as ServerRecord };
  }

  listServersBySource(source: ServerSource): ServerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM servers WHERE source = ? ORDER BY name COLLATE NOCASE")
      .all(source) as unknown as RawServer[];
    return rows.map((row) => toServer(row, this.healthChecksFor(row.id)));
  }

  private rawProject(projectId: string, includeArchived = false): RawProject | null {
    const archivedFilter = includeArchived ? "" : "AND p.archived_at IS NULL";
    const row = this.db
      .prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM project_servers WHERE project_id = p.id) AS server_count,
          (SELECT COUNT(*) FROM project_services WHERE project_id = p.id) AS service_count,
          (SELECT COUNT(*) FROM project_services WHERE project_id = p.id AND critical = 1) AS critical_service_count
        FROM projects p WHERE p.id = ? ${archivedFilter}
      `)
      .get(projectId) as unknown as RawProject | undefined;
    return row ?? null;
  }

  private projectServersFor(projectId: string): ProjectServerLink[] {
    const rows = this.db
      .prepare(`
        SELECT ps.server_id, ps.role, s.name AS server_name, s.address, s.ssh_port, s.status
        FROM project_servers ps
        JOIN servers s ON s.id = ps.server_id
        WHERE ps.project_id = ?
        ORDER BY s.name COLLATE NOCASE
      `)
      .all(projectId) as unknown as RawProjectServer[];
    return rows.map((row) => ({
      serverId: row.server_id,
      role: row.role,
      serverName: row.server_name,
      address: row.address,
      sshPort: row.ssh_port,
      status: row.status
    }));
  }

  private projectServicesFor(projectId: string): ProjectService[] {
    const rows = this.db
      .prepare(`
        SELECT ps.*, s.name AS server_name
        FROM project_services ps
        JOIN servers s ON s.id = ps.server_id
        WHERE ps.project_id = ?
        ORDER BY ps.critical DESC, ps.name COLLATE NOCASE
      `)
      .all(projectId) as unknown as RawProjectService[];
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      serverId: row.server_id,
      serverName: row.server_name,
      name: row.name,
      manager: row.manager,
      identifier: row.identifier,
      port: row.port,
      portMappings: normalizedStringList(parseJson<string[]>(row.port_mappings_json ?? "[]", [])),
      accessUrl: row.access_url,
      critical: row.critical === 1,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private assertProjectResources(servers: ProjectServerInput[], services: ProjectServiceInput[]): void {
    const serverIds = new Set<string>();
    for (const link of servers) {
      if (serverIds.has(link.serverId)) throw new Error("一个项目不能重复关联同一台 VPS");
      if (!this.getServer(link.serverId, true)) throw new Error(`关联的 VPS 不存在：${link.serverId}`);
      serverIds.add(link.serverId);
    }
    for (const service of services) {
      if (!serverIds.has(service.serverId)) {
        throw new Error(`服务“${service.name}”必须关联到该项目内的一台 VPS`);
      }
    }
  }

  private replaceProjectServers(projectId: string, servers: ProjectServerInput[]): void {
    this.db.prepare("DELETE FROM project_servers WHERE project_id = ?").run(projectId);
    const insert = this.db.prepare("INSERT INTO project_servers (project_id, server_id, role) VALUES (?, ?, ?)");
    for (const server of servers) {
      insert.run(projectId, server.serverId, server.role ?? "");
    }
  }

  private replaceProjectServices(projectId: string, services: ProjectServiceInput[], timestamp: string): void {
    this.db.prepare("DELETE FROM project_services WHERE project_id = ?").run(projectId);
    const insert = this.db.prepare(`
      INSERT INTO project_services
        (id, project_id, server_id, name, manager, identifier, port, port_mappings_json, access_url, critical, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const service of services) {
      insert.run(
        randomUUID(),
        projectId,
        service.serverId,
        service.name,
        service.manager,
        service.identifier,
        service.port ?? null,
        JSON.stringify(normalizedStringList(service.portMappings)),
        service.accessUrl ?? null,
        service.critical ? 1 : 0,
        service.notes ?? "",
        timestamp,
        timestamp
      );
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private rawSession(sessionId: string): RawSession | null {
    const row = this.db
      .prepare(`
        SELECT s.*, v.name AS server_name, v.address AS server_address,
          CASE WHEN s.status = 'queued' THEN (
            SELECT COUNT(*) FROM sessions q
            WHERE q.server_id = s.server_id
              AND q.status = 'queued'
              AND (q.created_at < s.created_at OR (q.created_at = s.created_at AND q.id <= s.id))
          ) ELSE 0 END AS queue_position,
          (
            SELECT a.id FROM sessions a
            WHERE a.server_id = s.server_id AND a.status = 'active'
            ORDER BY a.activated_at, a.created_at, a.id
            LIMIT 1
          ) AS active_session_id
        FROM sessions s
        JOIN servers v ON v.id = s.server_id
        WHERE s.id = ?
      `)
      .get(sessionId) as unknown as RawSession | undefined;
    return row ?? null;
  }

  private commandRunsFor(sessionId: string, limit = 100): CommandRunRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM command_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(sessionId, Math.min(Math.max(limit, 1), 200)) as unknown as RawCommandRun[];
    return rows.map(toCommandRun);
  }

  private promoteQueuedSessions(timestamp: string, idleTimeoutMs: number): string[] {
    const serverRows = this.db
      .prepare("SELECT DISTINCT server_id FROM sessions WHERE status IN ('active', 'queued')")
      .all() as unknown as Array<{ server_id: string }>;
    const promoted: string[] = [];
    const activeStatement = this.db.prepare("SELECT id FROM sessions WHERE server_id = ? AND status = 'active' LIMIT 1");
    const queuedStatement = this.db.prepare(
      "SELECT id, max_expires_at FROM sessions WHERE server_id = ? AND status = 'queued' ORDER BY created_at, id LIMIT 1"
    );
    const activateStatement = this.db.prepare(
      "UPDATE sessions SET status = 'active', activated_at = ?, last_activity_at = ?, idle_expires_at = ? WHERE id = ?"
    );

    for (const row of serverRows) {
      if (activeStatement.get(row.server_id)) continue;
      const queued = queuedStatement.get(row.server_id) as unknown as { id: string; max_expires_at: string } | undefined;
      if (!queued) continue;
      const idleExpiresAt = new Date(Math.min(Date.parse(queued.max_expires_at), Date.parse(timestamp) + idleTimeoutMs)).toISOString();
      activateStatement.run(timestamp, timestamp, idleExpiresAt, queued.id);
      promoted.push(queued.id);
    }
    return promoted;
  }

  private reconcileSessionsAt(timestamp: string, idleTimeoutMs: number): string[] {
    this.db
      .prepare(`
        UPDATE sessions
        SET status = 'expired', closed_at = ?, close_reason = 'lease_expired'
        WHERE status = 'active'
          AND operation_in_flight = 0
          AND (max_expires_at <= ? OR (idle_expires_at IS NOT NULL AND idle_expires_at <= ?))
      `)
      .run(timestamp, timestamp, timestamp);
    this.db
      .prepare(`
        UPDATE sessions
        SET status = 'expired', closed_at = ?, close_reason = 'queue_expired'
        WHERE status = 'queued' AND max_expires_at <= ?
      `)
      .run(timestamp, timestamp);
    return this.promoteQueuedSessions(timestamp, idleTimeoutMs);
  }

  reconcileSessions(idleTimeoutMs: number): string[] {
    const timestamp = now();
    return this.transaction(() => this.reconcileSessionsAt(timestamp, idleTimeoutMs));
  }

  openSession(
    serverId: string,
    requester: string,
    capabilityHash: string,
    idleTimeoutMs: number,
    maxDurationMs: number,
    queueIfBusy = true
  ): SessionRecord | null {
    const timestamp = now();
    return this.transaction(() => {
      this.reconcileSessionsAt(timestamp, idleTimeoutMs);
      if (!this.rawServer(serverId)) return null;
      const hasActive = Boolean(
        this.db.prepare("SELECT id FROM sessions WHERE server_id = ? AND status = 'active' LIMIT 1").get(serverId)
      );
      if (hasActive && !queueIfBusy) return null;
      const id = randomUUID();
      const maxExpiresAt = timestampAfter(timestamp, maxDurationMs);
      const idleExpiresAt = hasActive
        ? null
        : new Date(Math.min(Date.parse(maxExpiresAt), Date.parse(timestamp) + idleTimeoutMs)).toISOString();
      this.db
        .prepare(`
          INSERT INTO sessions
            (id, server_id, requester, status, created_at, activated_at, last_activity_at, idle_expires_at, max_expires_at, capability_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(id, serverId, requester, hasActive ? "queued" : "active", timestamp, hasActive ? null : timestamp, hasActive ? null : timestamp, idleExpiresAt, maxExpiresAt, capabilityHash);
      return toSession(this.rawSession(id) as RawSession);
    });
  }

  getSession(sessionId: string, idleTimeoutMs: number): SessionDetail | null {
    this.reconcileSessions(idleTimeoutMs);
    const raw = this.rawSession(sessionId);
    return raw ? { ...toSession(raw), commands: this.commandRunsFor(sessionId) } : null;
  }

  listActiveSessions(idleTimeoutMs: number): SessionRecord[] {
    this.reconcileSessions(idleTimeoutMs);
    const rows = this.db
      .prepare(`
        SELECT s.*, v.name AS server_name, v.address AS server_address,
          CASE WHEN s.status = 'queued' THEN (
            SELECT COUNT(*) FROM sessions q
            WHERE q.server_id = s.server_id
              AND q.status = 'queued'
              AND (q.created_at < s.created_at OR (q.created_at = s.created_at AND q.id <= s.id))
          ) ELSE 0 END AS queue_position,
          (
            SELECT a.id FROM sessions a
            WHERE a.server_id = s.server_id AND a.status = 'active'
            ORDER BY a.activated_at, a.created_at, a.id
            LIMIT 1
          ) AS active_session_id
        FROM sessions s
        JOIN servers v ON v.id = s.server_id
        WHERE s.status IN ('active', 'queued')
        ORDER BY CASE s.status WHEN 'active' THEN 0 ELSE 1 END, s.created_at, s.id
      `)
      .all() as unknown as RawSession[];
    return rows.map(toSession);
  }

  touchActiveSession(sessionId: string, idleTimeoutMs: number): SessionRecord | null {
    const timestamp = now();
    return this.transaction(() => {
      this.reconcileSessionsAt(timestamp, idleTimeoutMs);
      const current = this.rawSession(sessionId);
      if (!current || current.status !== "active") return null;
      const idleExpiresAt = new Date(
        Math.min(Date.parse(current.max_expires_at), Date.parse(timestamp) + idleTimeoutMs)
      ).toISOString();
      this.db
        .prepare("UPDATE sessions SET last_activity_at = ?, idle_expires_at = ? WHERE id = ?")
        .run(timestamp, idleExpiresAt, sessionId);
      return toSession(this.rawSession(sessionId) as RawSession);
    });
  }

  sessionCapabilityMatches(sessionId: string, capabilityHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS matches FROM sessions WHERE id = ? AND capability_hash = ?")
      .get(sessionId, capabilityHash) as unknown as { matches: number } | undefined;
    return Boolean(row);
  }

  acquireSessionOperation(
    sessionId: string,
    capabilityHash: string,
    idleTimeoutMs: number
  ): { status: "acquired"; session: SessionRecord } | { status: "not_found" | "unauthorized" | "inactive" | "busy"; session: SessionRecord | null } {
    const timestamp = now();
    return this.transaction(() => {
      this.reconcileSessionsAt(timestamp, idleTimeoutMs);
      const current = this.rawSession(sessionId);
      if (!current) return { status: "not_found", session: null };
      const session = toSession(current);
      if (current.capability_hash !== capabilityHash) return { status: "unauthorized", session };
      if (current.status !== "active") return { status: "inactive", session };
      if (current.operation_in_flight === 1) return { status: "busy", session };
      const idleExpiresAt = new Date(
        Math.min(Date.parse(current.max_expires_at), Date.parse(timestamp) + idleTimeoutMs)
      ).toISOString();
      const changed = this.db
        .prepare(`
          UPDATE sessions
          SET operation_in_flight = 1, last_activity_at = ?, idle_expires_at = ?
          WHERE id = ? AND status = 'active' AND operation_in_flight = 0 AND capability_hash = ?
        `)
        .run(timestamp, idleExpiresAt, sessionId, capabilityHash).changes;
      if (!changed) return { status: "busy", session: toSession(this.rawSession(sessionId) as RawSession) };
      return { status: "acquired", session: toSession(this.rawSession(sessionId) as RawSession) };
    });
  }

  releaseSessionOperation(sessionId: string, idleTimeoutMs: number): SessionRecord | null {
    const timestamp = now();
    return this.transaction(() => {
      const current = this.rawSession(sessionId);
      if (!current) return null;
      const idleExpiresAt = new Date(
        Math.min(Date.parse(current.max_expires_at), Date.parse(timestamp) + idleTimeoutMs)
      ).toISOString();
      this.db
        .prepare(`
          UPDATE sessions
          SET operation_in_flight = 0,
              last_activity_at = CASE WHEN status = 'active' THEN ? ELSE last_activity_at END,
              idle_expires_at = CASE WHEN status = 'active' THEN ? ELSE idle_expires_at END
          WHERE id = ?
        `)
        .run(timestamp, idleExpiresAt, sessionId);
      this.reconcileSessionsAt(timestamp, idleTimeoutMs);
      const released = this.rawSession(sessionId);
      return released ? toSession(released) : null;
    });
  }

  recoverInterruptedSessionOperations(): number {
    return Number(this.db.prepare("UPDATE sessions SET operation_in_flight = 0 WHERE operation_in_flight = 1").run().changes);
  }

  closeSession(sessionId: string, idleTimeoutMs: number, reason = "closed_by_operator"): { session: SessionRecord; promoted: SessionRecord | null } | null {
    const timestamp = now();
    return this.transaction(() => {
      this.reconcileSessionsAt(timestamp, idleTimeoutMs);
      const current = this.rawSession(sessionId);
      if (!current || !["active", "queued"].includes(current.status)) return null;
      if (current.operation_in_flight === 1) return null;
      this.db
        .prepare("UPDATE sessions SET status = 'closed', closed_at = ?, close_reason = ?, idle_expires_at = NULL WHERE id = ?")
        .run(timestamp, reason, sessionId);
      const promotedIds = this.promoteQueuedSessions(timestamp, idleTimeoutMs);
      const session = toSession(this.rawSession(sessionId) as RawSession);
      const promoted = promotedIds
        .map((promotedId) => this.rawSession(promotedId))
        .find((candidate) => candidate?.server_id === current.server_id) ?? null;
      return { session, promoted: promoted ? toSession(promoted) : null };
    });
  }

  saveCommandRun(input: Omit<CommandRunRecord, "id"> & { id?: string }): CommandRunRecord {
    const record: CommandRunRecord = { ...input, id: input.id ?? randomUUID() };
    this.db
      .prepare(`
        INSERT INTO command_runs
          (id, session_id, server_id, created_at, finished_at, command_text, risk, outcome, exit_code,
           stdout_text, stderr_text, output_truncated, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.sessionId,
        record.serverId,
        record.createdAt,
        record.finishedAt,
        record.command,
        record.risk,
        record.outcome,
        record.exitCode,
        record.stdout,
        record.stderr,
        record.outputTruncated ? 1 : 0,
        record.durationMs,
        record.error
      );
    return record;
  }

  listProjects(includeArchived = false): ProjectRecord[] {
    const archivedFilter = includeArchived ? "" : "WHERE p.archived_at IS NULL";
    const rows = this.db
      .prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM project_servers WHERE project_id = p.id) AS server_count,
          (SELECT COUNT(*) FROM project_services WHERE project_id = p.id) AS service_count,
          (SELECT COUNT(*) FROM project_services WHERE project_id = p.id AND critical = 1) AS critical_service_count
        FROM projects p
        ${archivedFilter}
        ORDER BY CASE WHEN p.archived_at IS NULL THEN 0 ELSE 1 END, p.name COLLATE NOCASE
      `)
      .all() as unknown as RawProject[];
    return rows.map(toProject);
  }

  projectsForServer(serverId: string, includeArchived = true): ServerProjectReference[] {
    const query = includeArchived
      ? "SELECT DISTINCT p.id, p.name, p.source, p.archived_at FROM projects p LEFT JOIN project_servers ps ON ps.project_id = p.id LEFT JOIN project_services psvc ON psvc.project_id = p.id WHERE (ps.server_id = ? OR psvc.server_id = ?) ORDER BY p.name COLLATE NOCASE"
      : "SELECT DISTINCT p.id, p.name, p.source, p.archived_at FROM projects p LEFT JOIN project_servers ps ON ps.project_id = p.id LEFT JOIN project_services psvc ON psvc.project_id = p.id WHERE (ps.server_id = ? OR psvc.server_id = ?) AND p.archived_at IS NULL ORDER BY p.name COLLATE NOCASE";
    const rows = this.db.prepare(query).all(serverId, serverId) as unknown as RawServerProjectReference[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source === "remote-inventory" ? "remote-inventory" : "manual",
      archivedAt: row.archived_at
    }));
  }

  getProject(projectId: string, includeArchived = false): ProjectDetail | null {
    const raw = this.rawProject(projectId, includeArchived);
    if (!raw) return null;
    return {
      ...toProject(raw),
      runbook: toRunbook(raw.runbook_json),
      servers: this.projectServersFor(raw.id),
      services: this.projectServicesFor(raw.id)
    };
  }

  createProject(input: CreateProjectInput): ProjectDetail {
    const id = randomUUID();
    const timestamp = now();
    const runbook = input.runbook ?? emptyRunbook();
    const servers = input.servers ?? [];
    const services = input.services ?? [];
    const technologyStack = normalizedStringList(input.technologyStack);
    const webEndpoints = normalizedWebEndpoints(input.webEndpoints);
    this.assertProjectResources(servers, services);
    return this.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO projects
            (id, source, source_key, source_synced_at, name, description, repository_url, repository_path, technology_stack_json, web_endpoints_json, runbook_json, created_at, updated_at)
          VALUES (?, 'manual', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          input.name,
          input.description ?? "",
          input.repositoryUrl ?? null,
          input.repositoryPath ?? null,
          JSON.stringify(technologyStack),
          JSON.stringify(webEndpoints),
          JSON.stringify(runbook),
          timestamp,
          timestamp
        );
      this.replaceProjectServers(id, servers);
      this.replaceProjectServices(id, services, timestamp);
      return this.getProject(id) as ProjectDetail;
    });
  }

  updateProject(projectId: string, patch: UpdateProjectInput): ProjectDetail | null {
    const existing = this.getProject(projectId);
    if (!existing) return null;
    const nextServers = patch.servers ?? existing.servers.map((server) => ({ serverId: server.serverId, role: server.role }));
    const nextServices = patch.services ?? existing.services.map((service) => ({
      serverId: service.serverId,
      name: service.name,
      manager: service.manager,
      identifier: service.identifier,
      port: service.port,
      portMappings: service.portMappings,
      accessUrl: service.accessUrl,
      critical: service.critical,
      notes: service.notes
    }));
    const nextTechnologyStack = patch.technologyStack === undefined ? existing.technologyStack : normalizedStringList(patch.technologyStack);
    const nextWebEndpoints = patch.webEndpoints === undefined ? existing.webEndpoints : normalizedWebEndpoints(patch.webEndpoints);
    this.assertProjectResources(nextServers, nextServices);
    const timestamp = now();
    return this.transaction(() => {
      this.db
        .prepare(`
            UPDATE projects SET name = ?, description = ?, repository_url = ?, repository_path = ?, technology_stack_json = ?, web_endpoints_json = ?, runbook_json = ?,
            updated_at = ? WHERE id = ?
        `)
        .run(
          patch.name ?? existing.name,
          patch.description ?? existing.description,
          patch.repositoryUrl === undefined ? existing.repositoryUrl : patch.repositoryUrl,
          patch.repositoryPath === undefined ? existing.repositoryPath : patch.repositoryPath,
          JSON.stringify(nextTechnologyStack),
          JSON.stringify(nextWebEndpoints),
          JSON.stringify(patch.runbook ?? existing.runbook),
          timestamp,
          projectId
        );
      if (patch.servers !== undefined) this.replaceProjectServers(projectId, nextServers);
      if (patch.services !== undefined) this.replaceProjectServices(projectId, nextServices, timestamp);
      return this.getProject(projectId) as ProjectDetail;
    });
  }

  syncDiscoveredProject(input: DiscoveredProjectInput): { action: InventorySyncAction; project: ProjectDetail } {
    const servers: ProjectServerInput[] = [{ serverId: input.serverId, role: "运行节点" }];
    const discoveredServices = input.services ?? [];
    const discoveredTechnologyStack = normalizedStringList(input.technologyStack);
    const discoveredWebEndpoints = normalizedWebEndpoints(input.webEndpoints);
    const discoveredBaseline = inventoryProjectBaseline(input, discoveredTechnologyStack, discoveredWebEndpoints, discoveredServices);
    this.assertProjectResources(servers, discoveredServices);
    const existingRow = this.db
      .prepare("SELECT id FROM projects WHERE source = 'remote-inventory' AND source_key = ?")
      .get(input.sourceKey) as unknown as { id: string } | undefined;
    const timestamp = now();
    if (!existingRow) {
      const id = randomUUID();
      this.transaction(() => {
        this.db
          .prepare(`
            INSERT INTO projects
              (id, source, source_key, source_synced_at, name, description, repository_url, repository_path, technology_stack_json, web_endpoints_json, runbook_json, inventory_baseline_json, created_at, updated_at)
            VALUES (?, 'remote-inventory', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            id,
            input.sourceKey,
            timestamp,
            input.name,
            input.description,
            input.repositoryPath ?? null,
            JSON.stringify(discoveredTechnologyStack),
            JSON.stringify(discoveredWebEndpoints),
            JSON.stringify(input.runbook),
            JSON.stringify(discoveredBaseline),
            timestamp,
            timestamp
          );
        this.replaceProjectServers(id, servers);
        this.replaceProjectServices(id, discoveredServices, timestamp);
      });
      return { action: "created", project: this.getProject(id) as ProjectDetail };
    }

    const existing = this.getProject(existingRow.id, true);
    if (!existing) throw new Error(`自动发现项目不存在：${input.sourceKey}`);
    const rawExisting = this.rawProject(existing.id, true) as RawProject;
    const storedBaseline = parseInventoryProjectBaseline(rawExisting.inventory_baseline_json);
    const previousBaseline = storedBaseline ?? (
      rawExisting.source_synced_at === rawExisting.updated_at
        ? {
            version: 1,
            name: existing.name,
            description: existing.description,
            repositoryPath: existing.repositoryPath,
            technologyStack: existing.technologyStack,
            webEndpoints: existing.webEndpoints.filter((endpoint) => endpoint.source === "remote-inventory"),
            runbook: existing.runbook,
            services: comparableProjectServices(existing.services)
          }
        : null
    );
    const nextName = previousBaseline && existing.name === previousBaseline.name ? input.name : existing.name;
    const nextDescription = previousBaseline && existing.description === previousBaseline.description ? input.description : existing.description;
    const nextRepositoryPath = previousBaseline && existing.repositoryPath === previousBaseline.repositoryPath
      ? input.repositoryPath ?? null
      : existing.repositoryPath;
    const nextRunbook = mergeInventoryRunbook(existing.runbook, previousBaseline?.runbook ?? null, input.runbook);
    const preservedManualEndpoints = existing.webEndpoints.filter((endpoint) => endpoint.source === "manual");
    const nextWebEndpoints = normalizedWebEndpoints([...discoveredWebEndpoints, ...preservedManualEndpoints]);
    const nextTechnologyStack = mergeInventoryTechnologyStack(
      existing.technologyStack,
      previousBaseline?.technologyStack ?? null,
      discoveredTechnologyStack
    );
    const nextServices = mergeInventoryServices(existing.services, previousBaseline, discoveredServices);
    this.assertProjectResources(servers, nextServices);
    const unchanged = existing.name === nextName &&
      existing.description === nextDescription &&
      existing.repositoryPath === nextRepositoryPath &&
      JSON.stringify(existing.runbook) === JSON.stringify(nextRunbook) &&
      JSON.stringify(existing.technologyStack) === JSON.stringify(nextTechnologyStack) &&
      JSON.stringify(existing.webEndpoints) === JSON.stringify(nextWebEndpoints) &&
      JSON.stringify(comparableProjectServices(existing.services)) === JSON.stringify(comparableProjectServices(nextServices)) &&
      existing.archivedAt === null;

    this.transaction(() => {
      this.db
        .prepare(`
            UPDATE projects SET source_synced_at = ?, name = ?, description = ?, repository_path = ?, technology_stack_json = ?, web_endpoints_json = ?, runbook_json = ?, inventory_baseline_json = ?,
            archived_at = NULL, updated_at = ? WHERE id = ?
          `)
        .run(
          timestamp,
          nextName,
          nextDescription,
          nextRepositoryPath,
          JSON.stringify(nextTechnologyStack),
          JSON.stringify(nextWebEndpoints),
          JSON.stringify(nextRunbook),
          JSON.stringify(discoveredBaseline),
          timestamp,
          existing.id
        );
      this.replaceProjectServers(existing.id, servers);
      this.replaceProjectServices(existing.id, nextServices, timestamp);
    });
    return { action: unchanged ? "unchanged" : "updated", project: this.getProject(existing.id) as ProjectDetail };
  }

  archiveMissingDiscoveredProjects(serverId: string, activeSourceKeys: string[]): number {
    const activeKeys = new Set(activeSourceKeys);
    const rows = this.db
      .prepare("SELECT id, source_key FROM projects WHERE source = 'remote-inventory' AND archived_at IS NULL AND source_key LIKE ?")
      .all(`${serverId}:%`) as unknown as Array<{ id: string; source_key: string }>;
    const stale = rows.filter((row) => !activeKeys.has(row.source_key));
    const archived = this.db
      .prepare(`
        SELECT DISTINCT p.id
        FROM projects p
        LEFT JOIN project_servers ps ON ps.project_id = p.id
        LEFT JOIN project_services psvc ON psvc.project_id = p.id
        WHERE p.source = 'remote-inventory' AND p.archived_at IS NOT NULL
          AND (ps.server_id = ? OR psvc.server_id = ?)
      `)
      .all(serverId, serverId) as unknown as Array<{ id: string }>;
    if (!stale.length && !archived.length) return 0;
    const timestamp = now();
    return this.transaction(() => {
      const update = this.db.prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?");
      for (const row of stale) update.run(timestamp, timestamp, row.id);
      // Archived inventory is historical documentation, not a live server association.
      // Detach it after a successful inventory pass so stale discoveries cannot block VPS lifecycle actions.
      const clearServices = this.db.prepare("DELETE FROM project_services WHERE project_id = ?");
      const clearServers = this.db.prepare("DELETE FROM project_servers WHERE project_id = ?");
      const archivedIds = new Set([...archived.map((row) => row.id), ...stale.map((row) => row.id)]);
      for (const projectId of archivedIds) {
        clearServices.run(projectId);
        clearServers.run(projectId);
      }
      return stale.length;
    });
  }

  archiveProject(projectId: string): boolean {
    const timestamp = now();
    const result = this.db
      .prepare("UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(timestamp, timestamp, projectId);
    return result.changes > 0;
  }

  deleteProject(projectId: string): { id: string; name: string } | null {
    const existing = this.getProject(projectId, true);
    if (!existing) return null;
    return this.transaction(() => {
      // Explicitly clear association rows so databases created before the cascade migration remain deletable.
      this.db.prepare("DELETE FROM project_services WHERE project_id = ?").run(projectId);
      this.db.prepare("DELETE FROM project_servers WHERE project_id = ?").run(projectId);
      const result = this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
      return result.changes ? { id: existing.id, name: existing.name } : null;
    });
  }

  archiveServer(serverId: string): boolean {
    const timestamp = now();
    const result = this.db
      .prepare("UPDATE servers SET archived_at = ?, status = 'archived', updated_at = ? WHERE id = ? AND archived_at IS NULL")
      .run(timestamp, timestamp, serverId);
    return result.changes > 0;
  }

  deleteServer(serverId: string): {
    deleted: boolean;
    server: ServerRecord | null;
    linkedProjects: ServerProjectReference[];
  } {
    const existing = this.getServer(serverId, true);
    if (!existing) return { deleted: false, server: null, linkedProjects: [] };
    const linkedProjects = this.projectsForServer(serverId, true);
    if (linkedProjects.length) return { deleted: false, server: existing, linkedProjects };
    const deleted = this.transaction(() => this.db.prepare("DELETE FROM servers WHERE id = ?").run(serverId).changes > 0);
    return { deleted, server: deleted ? existing : this.getServer(serverId, true), linkedProjects: [] };
  }

  clearServerAccessUrl(serverId: string): void {
    this.db.prepare("UPDATE servers SET access_url = NULL, updated_at = ? WHERE id = ? AND access_url IS NOT NULL").run(now(), serverId);
  }

  grantEmergencyRoot(serverId: string, durationMs: number): ServerRecord | null {
    const server = this.getServer(serverId);
    if (!server) return null;
    const grantedUntil = timestampAfter(now(), durationMs);
    this.db
      .prepare("UPDATE servers SET emergency_root_until = ?, updated_at = ? WHERE id = ?")
      .run(grantedUntil, now(), serverId);
    return this.getServer(serverId);
  }

  revokeEmergencyRoot(serverId: string): ServerRecord | null {
    const server = this.getServer(serverId);
    if (!server) return null;
    this.db
      .prepare("UPDATE servers SET emergency_root_until = NULL, updated_at = ? WHERE id = ?")
      .run(now(), serverId);
    return this.getServer(serverId);
  }

  emergencyRootActive(serverId: string): boolean {
    const server = this.getServer(serverId);
    return Boolean(server?.emergencyRootUntil && Date.parse(server.emergencyRootUntil) > Date.now());
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

  saveInventory(inventory: ServerInventory): void {
    this.db
      .prepare("INSERT INTO server_inventories (id, server_id, collected_at, inventory_json) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), inventory.serverId, inventory.collectedAt, JSON.stringify(inventory));
  }

  latestInventory(serverId: string): ServerInventory | null {
    const row = this.db
      .prepare("SELECT server_id, collected_at, inventory_json FROM server_inventories WHERE server_id = ? ORDER BY collected_at DESC LIMIT 1")
      .get(serverId) as unknown as RawInventory | undefined;
    if (!row) return null;
    const inventory = parseJson<ServerInventory | null>(row.inventory_json, null);
    return inventory ? { ...inventory, serverId: row.server_id, collectedAt: row.collected_at } : null;
  }

  pruneCommandRuns(before: string): number {
    const result = this.db
      .prepare("DELETE FROM command_runs WHERE finished_at IS NOT NULL AND finished_at < ?")
      .run(before);
    return Number(result.changes);
  }

  pruneMetrics(before: string): number {
    const result = this.db.prepare("DELETE FROM metrics WHERE collected_at < ?").run(before);
    return Number(result.changes);
  }

  latestMetric(serverId: string): MetricSnapshot | null {
    const row = this.db
      .prepare("SELECT server_id, collected_at, cpu_percent, memory_percent, disk_percent, load1, source, note FROM metrics WHERE server_id = ? ORDER BY collected_at DESC LIMIT 1")
      .get(serverId) as unknown as RawMetric | undefined;
    return row ? this.toMetric(row) : null;
  }

  metricHistory(serverId: string, limit = 48, since?: string): MetricSnapshot[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 240);
    const rows = this.db
      .prepare(`
        SELECT server_id, collected_at, cpu_percent, memory_percent, disk_percent, load1, source, note
        FROM metrics
        WHERE server_id = ? AND (? IS NULL OR collected_at >= ?)
        ORDER BY collected_at DESC
        LIMIT ?
      `)
      .all(serverId, since ?? null, since ?? null, safeLimit) as unknown as RawMetric[];
    return rows.map((row) => this.toMetric(row)).reverse();
  }

  private toMetric(row: RawMetric): MetricSnapshot {
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
    const safeMetadata = sanitizeAuditMetadata(metadata);
    const safeSummary = redactText(summary, 2_000).value;
    const event: AuditEvent = {
      id: randomUUID(),
      createdAt: now(),
      action,
      targetType,
      targetId,
      severity,
      summary: safeSummary,
      metadata: safeMetadata
    };
    this.db
      .prepare("INSERT INTO audit_events (id, created_at, action, target_type, target_id, severity, summary, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(event.id, event.createdAt, action, targetType, targetId, severity, safeSummary, JSON.stringify(safeMetadata));
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

  recentMetricAlerts(limit = 30): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_events WHERE action = ? ORDER BY created_at DESC LIMIT ?")
      .all("metrics.alert", Math.min(Math.max(limit, 1), 200)) as unknown as RawAuditEvent[];
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
