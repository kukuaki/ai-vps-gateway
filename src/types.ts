export type ServerStatus = "unknown" | "healthy" | "degraded" | "ssh_unreachable" | "offline" | "maintenance" | "archived";
export type ServerSource = "manual" | "all-vps";
export type HealthCheckKind = "http" | "tcp";

export interface HealthCheckConfig {
  url?: string;
  host?: string;
  port?: number;
  expectedStatusCodes?: number[];
  timeoutMs?: number;
}

export interface HealthCheck {
  id: string;
  serverId: string;
  name: string;
  kind: HealthCheckKind;
  enabled: boolean;
  config: HealthCheckConfig;
}

export interface ServerRecord {
  id: string;
  source: ServerSource;
  sourceKey: string | null;
  sourceSyncedAt: string | null;
  archivedAt: string | null;
  name: string;
  address: string;
  sshPort: number;
  sshUser: string;
  credentialRef: string | null;
  emergencyRootUntil: string | null;
  role: string;
  environment: string;
  accessUrl: string | null;
  tags: string[];
  maintenance: boolean;
  status: ServerStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  healthChecks: HealthCheck[];
}

export interface ProbeResult {
  kind: "tcp" | "ssh_banner" | "http";
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
  statusCode?: number;
}

export interface HealthEvent {
  id: string;
  checkedAt: string;
  status: ServerStatus;
  results: ProbeResult[];
  error: string | null;
}

export interface MetricSnapshot {
  serverId: string;
  collectedAt: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  load1: number | null;
  source: "ssh" | "unavailable";
  note: string | null;
}

export type SessionStatus = "queued" | "active" | "closed" | "expired";
export type CommandRisk = "normal" | "high" | "critical";
export type CommandOutcome = "completed" | "failed" | "timed_out" | "blocked";

export interface SessionRecord {
  id: string;
  serverId: string;
  serverName: string;
  serverAddress: string;
  status: SessionStatus;
  requester: string;
  createdAt: string;
  activatedAt: string | null;
  lastActivityAt: string | null;
  idleExpiresAt: string | null;
  maxExpiresAt: string;
  closedAt: string | null;
  closeReason: string | null;
  queuePosition: number;
  activeSessionId: string | null;
}

export interface CommandRunRecord {
  id: string;
  sessionId: string;
  serverId: string;
  createdAt: string;
  finishedAt: string | null;
  command: string;
  risk: CommandRisk;
  outcome: CommandOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number | null;
  error: string | null;
}

export interface SessionDetail extends SessionRecord {
  commands: CommandRunRecord[];
}

export interface ServerDetail {
  server: ServerRecord;
  events: HealthEvent[];
  metric: MetricSnapshot | null;
}

export interface DashboardSummary {
  total: number;
  healthy: number;
  degraded: number;
  unreachable: number;
  unknown: number;
  lastUpdatedAt: string | null;
}

export interface DashboardResponse {
  summary: DashboardSummary;
  servers: ServerRecord[];
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId: string | null;
  severity: "info" | "warning" | "critical";
  summary: string;
  metadata: Record<string, unknown>;
}

export interface ServerPayload {
  name: string;
  address: string;
  sshPort: number;
  sshUser: string;
  credentialRef: string | null;
  role: string;
  environment: string;
  accessUrl: string | null;
  tags: string[];
  maintenance: boolean;
  healthChecks: Array<{
    name: string;
    kind: HealthCheckKind;
    enabled: boolean;
    config: HealthCheckConfig;
  }>;
}

export type ServiceManager = "docker" | "systemd" | "process" | "external";

export interface ProjectRunbook {
  overview: string;
  deployment: string;
  verification: string;
  troubleshooting: string;
  guardrails: string;
}

export interface ProjectServerLink {
  serverId: string;
  role: string;
  serverName: string;
  address: string;
  sshPort: number;
  status: ServerStatus;
}

export interface ProjectService {
  id: string;
  projectId: string;
  serverId: string;
  serverName: string;
  name: string;
  manager: ServiceManager;
  identifier: string;
  port: number | null;
  accessUrl: string | null;
  critical: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  repositoryUrl: string | null;
  repositoryPath: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverCount: number;
  serviceCount: number;
  criticalServiceCount: number;
}

export interface ProjectDetail extends ProjectRecord {
  runbook: ProjectRunbook;
  servers: ProjectServerLink[];
  services: ProjectService[];
}

export interface ProjectPayload {
  name: string;
  description: string;
  repositoryUrl: string | null;
  repositoryPath: string | null;
  runbook: ProjectRunbook;
  servers: Array<{ serverId: string; role: string }>;
  services: Array<{
    serverId: string;
    name: string;
    manager: ServiceManager;
    identifier: string;
    port: number | null;
    accessUrl: string | null;
    critical: boolean;
    notes: string;
  }>;
}

export interface AllVpsSourceInfo {
  inventoryFile: string;
  domainsFile: string;
  digest: string;
}

export interface AllVpsSyncChange {
  action: "created" | "updated" | "unchanged";
  serverId: string | null;
  sourceKey: string;
  name: string;
  changes: string[];
}

export interface AllVpsSyncPreview {
  source: AllVpsSourceInfo;
  changes: AllVpsSyncChange[];
  stale: Array<{ id: string; name: string; sourceKey: string }>;
  warnings: string[];
  summary: { created: number; updated: number; unchanged: number; stale: number };
}
