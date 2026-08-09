import { GatewayDatabase } from "./db.js";
import { assessCommand, displayCommand, redactText } from "./command-policy.js";
import { CredentialError } from "./credentials.js";
import { INVENTORY_COMMAND, parseInventoryOutput } from "./inventory.js";
import { SshExecutor } from "./ssh.js";
import type {
  CommandExecutionResult,
  CommandOutcome,
  CommandRunRecord,
  MetricSnapshot,
  ServerRecord,
  ServerInventory,
  SessionDetail,
  SessionRecord
} from "./types.js";

export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
export const DEFAULT_SESSION_MAX_DURATION_MS = 8 * 60 * 60 * 1_000;

const METRICS_COMMAND = String.raw`sh -c 'cpu_sample() { awk '\''/^cpu / { idle=$5+$6; total=$2+$3+$4+$5+$6+$7+$8+$9+$10; print idle,total; exit }'\'' /proc/stat; }; cpu_a=$(cpu_sample); sleep 1; cpu_b=$(cpu_sample); cpu=$(awk -v a="$cpu_a" -v b="$cpu_b" '\''BEGIN { split(a,x," "); split(b,y," "); dt=y[2]-x[2]; di=y[1]-x[1]; if (dt > 0) printf "%.2f", (1 - di / dt) * 100; }'\''); memory=$(awk '\''/MemTotal:/ { total=$2 } /MemAvailable:/ { available=$2 } END { if (total > 0) printf "%.2f", (total - available) * 100 / total; }'\'' /proc/meminfo); disk=$(df -Pk / 2>/dev/null | awk '\''NR == 2 { gsub("%", "", $5); print $5; }'\''); load=$(awk '\''{ print $1; exit }'\'' /proc/loadavg 2>/dev/null); printf '\''%s\\n'\'' "cpu_percent=$cpu" "memory_percent=$memory" "disk_percent=$disk" "load1=$load"'`;
// Keep the remote formatter to one escaped newline; String.raw preserves source backslashes verbatim.
const METRICS_COMMAND_FOR_SSH = METRICS_COMMAND.replace("%s\\\\n", "%s\\n");

export class GatewayOperationError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GatewayOperationError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface GatewayOperationOptions {
  idleTimeoutMs?: number;
  maxSessionDurationMs?: number;
  sweepIntervalMs?: number;
  commandRetentionMs?: number;
  metricRetentionMs?: number;
  sshExecutor?: SshExecutor;
}

function boundedDuration(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value ?? fallback, minimum), maximum);
}

function requesterName(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, 120) : "mcp";
}

function transientRequester(value: string): boolean {
  return /(?:^|:)(?:metrics|inventory|project-sync)$/.test(value);
}

function riskSeverity(risk: "normal" | "high" | "critical"): "info" | "warning" | "critical" {
  return risk === "critical" ? "critical" : risk === "high" ? "warning" : "info";
}

function parseMetricValue(output: string, key: string): number | null {
  const match = new RegExp(`(?:^|\\n)${key}=([^\\n]*)`).exec(output);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function unavailableMetric(serverId: string, note: string): MetricSnapshot {
  return {
    serverId,
    collectedAt: new Date().toISOString(),
    cpuPercent: null,
    memoryPercent: null,
    diskPercent: null,
    load1: null,
    source: "unavailable",
    note
  };
}

function normalizeMetric(metric: MetricSnapshot): MetricSnapshot {
  const bounded = (value: number | null, maximum: number | null = null): number | null => {
    if (value === null || !Number.isFinite(value) || value < 0) return null;
    return maximum === null ? value : Math.min(value, maximum);
  };
  return {
    ...metric,
    cpuPercent: bounded(metric.cpuPercent, 100),
    memoryPercent: bounded(metric.memoryPercent, 100),
    diskPercent: bounded(metric.diskPercent, 100),
    load1: bounded(metric.load1)
  };
}

const METRIC_ALERT_THRESHOLDS = {
  cpuPercent: 90,
  memoryPercent: 90,
  diskPercent: 85
} as const;

export function metricAlertSignals(metric: MetricSnapshot | null): string[] {
  if (!metric) return [];
  if (metric.source === "unavailable") return ["性能不可用"];
  const signals: string[] = [];
  if ((metric.cpuPercent ?? 0) >= METRIC_ALERT_THRESHOLDS.cpuPercent) signals.push("CPU 高");
  if ((metric.memoryPercent ?? 0) >= METRIC_ALERT_THRESHOLDS.memoryPercent) signals.push("内存高");
  if ((metric.diskPercent ?? 0) >= METRIC_ALERT_THRESHOLDS.diskPercent) signals.push("磁盘将满");
  return signals;
}

function recordMetricAlerts(database: GatewayDatabase, server: ServerRecord, previous: MetricSnapshot | null, metric: MetricSnapshot): void {
  const currentSignals = metricAlertSignals(metric);
  const previousSignals = metricAlertSignals(previous);
  const newSignals = currentSignals.filter((signal) => !previousSignals.includes(signal));
  if (!newSignals.length) return;
  if (metric.source === "unavailable" && (!previous || previous.source === "unavailable")) return;
  database.audit("metrics.alert", "server", server.id, `性能告警：${server.name} · ${newSignals.join("、")}`, "warning", {
    serverId: server.id,
    signals: newSignals,
    collectedAt: metric.collectedAt,
    cpuPercent: metric.cpuPercent,
    memoryPercent: metric.memoryPercent,
    diskPercent: metric.diskPercent,
    load1: metric.load1,
    note: metric.note
  });
}

export class GatewayOperations {
  readonly database: GatewayDatabase;
  readonly ssh: SshExecutor;
  readonly idleTimeoutMs: number;
  readonly maxSessionDurationMs: number;
  readonly commandRetentionMs: number;
  readonly metricRetentionMs: number;
  private readonly sweepIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(database: GatewayDatabase, options: GatewayOperationOptions = {}) {
    this.database = database;
    this.ssh = options.sshExecutor ?? new SshExecutor();
    this.idleTimeoutMs = boundedDuration(options.idleTimeoutMs, DEFAULT_SESSION_IDLE_TIMEOUT_MS, 1_000, 24 * 60 * 60 * 1_000);
    this.maxSessionDurationMs = boundedDuration(options.maxSessionDurationMs, DEFAULT_SESSION_MAX_DURATION_MS, 60_000, 7 * 24 * 60 * 60 * 1_000);
    this.sweepIntervalMs = boundedDuration(options.sweepIntervalMs, 30_000, 5_000, 5 * 60_000);
    this.commandRetentionMs = boundedDuration(options.commandRetentionMs, 90 * 24 * 60 * 60 * 1_000, 24 * 60 * 60 * 1_000, 365 * 24 * 60 * 60 * 1_000);
    this.metricRetentionMs = boundedDuration(options.metricRetentionMs, 30 * 24 * 60 * 60 * 1_000, 24 * 60 * 60 * 1_000, 365 * 24 * 60 * 60 * 1_000);
  }

  start(): void {
    if (this.timer) return;
    this.reconcile();
    for (const session of this.database.listActiveSessions(this.idleTimeoutMs)) {
      if (session.status === "active" && transientRequester(session.requester)) {
        this.closeSession(session.id, "gateway_restarted_transient");
      }
    }
    this.timer = setInterval(() => this.reconcile(), this.sweepIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reconcile(): void {
    this.database.reconcileSessions(this.idleTimeoutMs);
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of this.database.listActiveSessions(this.idleTimeoutMs)) {
        const server = this.database.getServer(session.serverId);
        if (session.status !== "active" || server?.sshUser !== "root" || this.database.emergencyRootActive(session.serverId)) continue;
        const closed = this.database.closeSession(session.id, this.idleTimeoutMs, "emergency_root_expired");
        if (closed) {
          changed = true;
          this.database.audit("session.root_expired", "session", session.id, `紧急 root 授权已过期：${server.name}`, "critical", {
            serverId: server.id
          });
        }
      }
    }
    this.database.pruneCommandRuns(new Date(Date.now() - this.commandRetentionMs).toISOString());
    this.database.pruneMetrics(new Date(Date.now() - this.metricRetentionMs).toISOString());
  }

  listSessions(): SessionRecord[] {
    return this.database.listActiveSessions(this.idleTimeoutMs);
  }

  getSession(sessionId: string): SessionDetail | null {
    return this.database.getSession(sessionId, this.idleTimeoutMs);
  }

  openSession(serverId: string, requester?: string): SessionRecord {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
      throw new GatewayOperationError(409, "EmergencyRootRequired", "这台 VPS 使用 root SSH 登录，请先在 WebUI 开启限时紧急 root 救援");
    }
    try {
      this.ssh.credentialStore.pathFor(server);
    } catch (error) {
      const message = error instanceof CredentialError ? error.message : "网关凭据不可用";
      throw new GatewayOperationError(409, "CredentialUnavailable", message);
    }
    if (!this.ssh.credentialStore.hasKnownHosts()) {
      throw new GatewayOperationError(409, "KnownHostsUnavailable", "本机没有可用的 SSH known_hosts，先完成主机指纹登记");
    }
    const session = this.database.openSession(
      serverId,
      requesterName(requester),
      this.idleTimeoutMs,
      this.maxSessionDurationMs
    );
    if (!session) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    this.database.audit(
      "session.opened",
      "session",
      session.id,
      session.status === "active" ? `开启 VPS 会话：${server.name}` : `VPS 会话进入排队：${server.name}`,
      session.status === "active" ? "info" : "warning",
      { serverId, requester: session.requester, status: session.status, queuePosition: session.queuePosition }
    );
    return session;
  }

  closeSession(sessionId: string, reason = "closed_by_operator"): { session: SessionRecord; promoted: SessionRecord | null } {
    const result = this.database.closeSession(sessionId, this.idleTimeoutMs, reason);
    if (!result) throw new GatewayOperationError(404, "NotFound", "未找到可关闭的会话");
    this.database.audit("session.closed", "session", sessionId, "关闭 VPS 会话", "info", { reason });
    if (result.promoted) {
      this.database.audit("session.promoted", "session", result.promoted.id, "排队会话已获得 VPS 租约", "info", {
        serverId: result.promoted.serverId
      });
    }
    return result;
  }

  revokeEmergencyRoot(serverId: string): ServerRecord {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    const updated = this.database.revokeEmergencyRoot(serverId);
    if (!updated) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of this.database.listActiveSessions(this.idleTimeoutMs).filter((item) => item.serverId === serverId)) {
        const closed = this.database.closeSession(session.id, this.idleTimeoutMs, "emergency_root_revoked");
        if (!closed) continue;
        changed = true;
        this.database.audit("session.root_revoked", "session", session.id, `紧急 root 已撤销，会话已结束：${server.name}`, "critical", { serverId });
      }
    }
    this.database.audit("server.emergency_root.revoked", "server", serverId, `关闭紧急 root 救援：${server.name}`, "critical");
    return updated;
  }

  async runCommand(sessionId: string, command: string, timeoutMs?: number): Promise<CommandExecutionResult> {
    const session = this.database.getSession(sessionId, this.idleTimeoutMs);
    if (!session) throw new GatewayOperationError(404, "NotFound", "未找到会话");
    if (session.status !== "active") {
      throw new GatewayOperationError(409, "SessionNotActive", session.status === "queued" ? "会话仍在排队，当前 VPS 由其他会话占用" : "会话已结束，不能继续执行命令", {
        session
      });
    }
    const server = this.database.getServer(session.serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "会话对应的 VPS 不存在");
    if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
      this.database.closeSession(sessionId, this.idleTimeoutMs, "emergency_root_expired");
      this.database.audit("session.root_expired", "session", sessionId, `紧急 root 授权已过期：${server.name}`, "critical", {
        serverId: server.id
      });
      throw new GatewayOperationError(409, "EmergencyRootExpired", "紧急 root 授权已过期，会话已结束");
    }
    const assessment = assessCommand(command);
    const safeCommand = displayCommand(command);
    const createdAt = new Date().toISOString();

    if (assessment.blocked) {
      const record = this.database.saveCommandRun({
        sessionId,
        serverId: server.id,
        createdAt,
        finishedAt: createdAt,
        command: safeCommand,
        risk: assessment.risk,
        outcome: "blocked",
        exitCode: null,
        stdout: "",
        stderr: "",
        outputTruncated: false,
        durationMs: 0,
        error: assessment.reason
      });
      this.database.audit("command.blocked", "session", sessionId, `阻断高危命令：${server.name}`, "critical", {
        serverId: server.id,
        command: safeCommand,
        risk: assessment.risk,
        signals: assessment.signals,
        reason: assessment.reason
      });
      return { ...record, blockedReason: assessment.reason };
    }

    if (!this.database.touchActiveSession(sessionId, this.idleTimeoutMs)) {
      throw new GatewayOperationError(409, "SessionExpired", "会话已过期，不能继续执行命令");
    }

    let outcome: CommandOutcome = "failed";
    let exitCode: number | null = null;
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let durationMs: number | null = null;
    let error: string | null = null;
    try {
      const result = await this.ssh.execute(server, command, timeoutMs);
      exitCode = result.exitCode;
      const safeStdout = redactText(result.stdout);
      const safeStderr = redactText(result.stderr);
      stdout = safeStdout.value;
      stderr = safeStderr.value;
      outputTruncated = result.outputTruncated || safeStdout.truncated || safeStderr.truncated;
      durationMs = result.durationMs;
      error = result.error;
      outcome = result.timedOut ? "timed_out" : result.exitCode === 0 ? "completed" : "failed";
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "SSH 执行失败";
      outcome = "failed";
    }
    const finishedAt = new Date().toISOString();
    const record = this.database.saveCommandRun({
      sessionId,
      serverId: server.id,
      createdAt,
      finishedAt,
      command: safeCommand,
      risk: assessment.risk,
      outcome,
      exitCode,
      stdout,
      stderr,
      outputTruncated,
      durationMs,
      error
    });
    this.database.audit("command.executed", "session", sessionId, `执行远程命令：${server.name}`, riskSeverity(assessment.risk), {
      serverId: server.id,
      command: safeCommand,
      risk: assessment.risk,
      signals: assessment.signals,
      outcome,
      exitCode,
      durationMs
    });
    this.database.touchActiveSession(sessionId, this.idleTimeoutMs);
    return { ...record, blockedReason: null };
  }

  async collectMetrics(serverId: string, sessionId?: string, requester = "metrics"): Promise<MetricSnapshot> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    const previousMetric = this.database.latestMetric(serverId);
    let temporarySession: SessionRecord | null = null;
    if (sessionId) {
      const session = this.database.getSession(sessionId, this.idleTimeoutMs);
      if (!session || session.serverId !== serverId) throw new GatewayOperationError(409, "SessionMismatch", "会话与 VPS 不匹配");
      if (session.status !== "active") throw new GatewayOperationError(409, "SessionNotActive", "会话尚未获得 VPS 租约", { session });
      if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
        this.database.closeSession(sessionId, this.idleTimeoutMs, "emergency_root_expired");
        throw new GatewayOperationError(409, "EmergencyRootExpired", "紧急 root 授权已过期，会话已结束");
      }
      if (!this.database.touchActiveSession(sessionId, this.idleTimeoutMs)) {
        throw new GatewayOperationError(409, "SessionExpired", "会话已过期，不能采集性能");
      }
    } else {
      try {
        if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
          throw new Error("这台 VPS 使用 root SSH 登录，请先在 WebUI 开启限时紧急 root 救援");
        }
        this.ssh.credentialStore.pathFor(server);
        if (!this.ssh.credentialStore.hasKnownHosts()) throw new Error("本机没有可用的 SSH known_hosts");
      } catch (error) {
        const note = error instanceof Error ? error.message : "网关凭据不可用";
        const metric = unavailableMetric(serverId, note);
        this.database.saveMetric(metric);
        recordMetricAlerts(this.database, server, previousMetric, metric);
        return metric;
      }
      temporarySession = this.database.openSession(serverId, requesterName(requester), this.idleTimeoutMs, 5 * 60_000, false);
      if (!temporarySession) {
        const metric = unavailableMetric(serverId, "服务器当前已有会话占用，稍后重试性能采集");
        this.database.saveMetric(metric);
        recordMetricAlerts(this.database, server, previousMetric, metric);
        return metric;
      }
    }

    try {
      const result = await this.ssh.execute(server, METRICS_COMMAND_FOR_SSH, 20_000);
      if (result.timedOut || result.exitCode !== 0) {
        const detail = redactText(result.stderr || result.error || "远程性能命令执行失败", 2_000).value;
        const metric = unavailableMetric(serverId, detail);
        this.database.saveMetric(metric);
        recordMetricAlerts(this.database, server, previousMetric, metric);
        this.database.audit("metrics.failed", "server", serverId, `性能采集失败：${server.name}`, "warning", { sessionId, detail });
        return metric;
      }
      const metric = normalizeMetric({
        serverId,
        collectedAt: new Date().toISOString(),
        cpuPercent: parseMetricValue(result.stdout, "cpu_percent"),
        memoryPercent: parseMetricValue(result.stdout, "memory_percent"),
        diskPercent: parseMetricValue(result.stdout, "disk_percent"),
        load1: parseMetricValue(result.stdout, "load1"),
        source: "ssh",
        note: null
      });
      if ([metric.cpuPercent, metric.memoryPercent, metric.diskPercent, metric.load1].some((value) => value === null)) {
        metric.note = "远程系统未返回完整的 Linux 性能字段";
      }
      this.database.saveMetric(metric);
      recordMetricAlerts(this.database, server, previousMetric, metric);
      this.database.audit("metrics.collected", "server", serverId, `采集性能快照：${server.name}`, "info", {
        sessionId,
        source: metric.source
      });
      return metric;
    } finally {
      if (temporarySession) this.closeSession(temporarySession.id, "metrics_completed");
      else if (sessionId) this.database.touchActiveSession(sessionId, this.idleTimeoutMs);
    }
  }

  async collectInventory(serverId: string, sessionId?: string, requester = "inventory"): Promise<ServerInventory> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    let temporarySession: SessionRecord | null = null;
    if (sessionId) {
      const session = this.database.getSession(sessionId, this.idleTimeoutMs);
      if (!session || session.serverId !== serverId) throw new GatewayOperationError(409, "SessionMismatch", "会话与 VPS 不匹配");
      if (session.status !== "active") throw new GatewayOperationError(409, "SessionNotActive", "会话尚未获得 VPS 租约", { session });
      if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
        this.database.closeSession(sessionId, this.idleTimeoutMs, "emergency_root_expired");
        throw new GatewayOperationError(409, "EmergencyRootExpired", "紧急 root 授权已过期，会话已结束");
      }
      if (!this.database.touchActiveSession(sessionId, this.idleTimeoutMs)) {
        throw new GatewayOperationError(409, "SessionExpired", "会话已过期，不能盘点项目");
      }
    } else {
      try {
        if (server.sshUser === "root" && !this.database.emergencyRootActive(server.id)) {
          throw new Error("这台 VPS 使用 root SSH 登录，请先在 WebUI 开启限时紧急 root 救援");
        }
        this.ssh.credentialStore.pathFor(server);
        if (!this.ssh.credentialStore.hasKnownHosts()) throw new Error("本机没有可用的 SSH known_hosts");
      } catch (error) {
        throw new GatewayOperationError(409, "InventoryUnavailable", error instanceof Error ? error.message : "网关凭据不可用");
      }
      temporarySession = this.database.openSession(serverId, requesterName(requester), this.idleTimeoutMs, 5 * 60_000, false);
      if (!temporarySession) throw new GatewayOperationError(409, "ServerBusy", "服务器当前已有会话占用，请稍后盘点");
    }

    try {
      const result = await this.ssh.execute(server, INVENTORY_COMMAND, 30_000);
      const inventory = parseInventoryOutput(serverId, result.stdout);
      const detail = redactText(result.stderr || result.error || "", 2_000).value;
      if (result.timedOut || result.exitCode !== 0) {
        inventory.warnings.push(detail || "远程盘点命令未完整执行");
        this.database.audit("inventory.failed", "server", serverId, `项目盘点部分失败：${server.name}`, "warning", {
          sessionId,
          exitCode: result.exitCode,
          detail
        });
      } else {
        this.database.audit("inventory.collected", "server", serverId, `完成项目盘点：${server.name}`, "info", {
          sessionId,
          projects: inventory.projects.length,
          services: inventory.services.length,
          ports: inventory.listeningPorts.length
        });
      }
      this.database.saveInventory(inventory);
      return inventory;
    } finally {
      if (temporarySession) this.closeSession(temporarySession.id, "inventory_completed");
      else if (sessionId) this.database.touchActiveSession(sessionId, this.idleTimeoutMs);
    }
  }
}
