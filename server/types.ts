export const SERVER_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "ssh_unreachable",
  "offline",
  "maintenance",
  "archived"
] as const;

export type ServerStatus = (typeof SERVER_STATUSES)[number];
export const SERVER_SOURCES = ["manual", "all-vps"] as const;
export type ServerSource = (typeof SERVER_SOURCES)[number];
export type HealthCheckKind = "http" | "tcp";
export type AuditSeverity = "info" | "warning" | "critical";
export const SERVICE_MANAGERS = ["docker", "systemd", "process", "external"] as const;
export type ServiceManager = (typeof SERVICE_MANAGERS)[number];
export const SESSION_STATUSES = ["queued", "active", "closed", "expired"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type CommandRisk = "normal" | "high" | "critical";
export type CommandOutcome = "completed" | "failed" | "timed_out" | "blocked";

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

export interface CreateServerInput {
  name: string;
  address: string;
  sshPort: number;
  sshUser: string;
  credentialRef?: string | null;
  role?: string;
  environment?: string;
  accessUrl?: string | null;
  tags?: string[];
  maintenance?: boolean;
  healthChecks?: Array<{
    name: string;
    kind: HealthCheckKind;
    enabled?: boolean;
    config: HealthCheckConfig;
  }>;
}

export type UpdateServerInput = Partial<CreateServerInput>;

export interface ProjectRunbook {
  overview: string;
  deployment: string;
  verification: string;
  troubleshooting: string;
  guardrails: string;
}

export interface ProjectServerInput {
  serverId: string;
  role?: string;
}

export interface ProjectServiceInput {
  serverId: string;
  name: string;
  manager: ServiceManager;
  identifier: string;
  port?: number | null;
  accessUrl?: string | null;
  critical?: boolean;
  notes?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  repositoryUrl?: string | null;
  repositoryPath?: string | null;
  runbook?: ProjectRunbook;
  servers?: ProjectServerInput[];
  services?: ProjectServiceInput[];
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

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

export interface ProjectDetail extends ProjectRecord {
  runbook: ProjectRunbook;
  servers: ProjectServerLink[];
  services: ProjectService[];
}

export interface ImportedServerInput {
  source: "all-vps";
  sourceKey: string;
  input: CreateServerInput;
}

export type ImportSyncAction = "created" | "updated" | "unchanged";

export interface ImportSyncPreview {
  action: ImportSyncAction;
  serverId: string | null;
  sourceKey: string;
  name: string;
  changes: string[];
}

export interface ImportSyncResult extends ImportSyncPreview {
  server: ServerRecord;
}

export interface ProbeResult {
  kind: "tcp" | "ssh_banner" | "http";
  name: string;
  ok: boolean;
  latencyMs: number;
  detail: string;
  statusCode?: number;
}

export interface ProbeSummary {
  serverId: string;
  status: ServerStatus;
  checkedAt: string;
  results: ProbeResult[];
  error: string | null;
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId: string | null;
  severity: AuditSeverity;
  summary: string;
  metadata: Record<string, unknown>;
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

export interface CommandExecutionResult extends CommandRunRecord {
  blockedReason: string | null;
}

export interface SessionDetail extends SessionRecord {
  commands: CommandRunRecord[];
}

export interface DashboardSummary {
  total: number;
  healthy: number;
  degraded: number;
  unreachable: number;
  unknown: number;
  lastUpdatedAt: string | null;
}
