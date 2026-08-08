export type ServerStatus = "unknown" | "healthy" | "degraded" | "ssh_unreachable" | "offline" | "maintenance" | "archived";
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
