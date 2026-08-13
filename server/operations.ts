import { createHash, randomBytes } from "node:crypto";
import { GatewayDatabase } from "./db.js";
import { assessCommand, displayCommand, redactText } from "./command-policy.js";
import { buildSshBootstrapCommand, CredentialError } from "./credentials.js";
import { INVENTORY_COMMAND, parseInventoryOutput } from "./inventory.js";
import { SshExecutor } from "./ssh.js";
import type {
  CommandExecutionResult,
  CommandOutcome,
  CommandRunRecord,
  MetricSnapshot,
  ServerRecord,
  ServerInventory,
  SshBindingInfo,
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

export interface SshBindingResult {
  server: ServerRecord;
  binding: SshBindingInfo;
}

export interface SessionLease {
  session: SessionRecord;
  capabilityToken: string;
}

function newCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

function capabilityHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

function sshBindingErrorDetail(result: { timedOut: boolean; stderr: string; error: string | null; exitCode: number | null }): string {
  if (result.timedOut) return "连接超时";
  const detail = redactText(result.stderr || result.error || "SSH 未接受该公钥", 1_000).value
    .replace(/\s+/g, " ")
    .trim();
  return detail || (result.exitCode === null ? "无法启动本机 SSH 客户端" : `SSH 返回退出码 ${result.exitCode}`);
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
  private readonly bindingTasks = new Map<string, Promise<SshBindingResult>>();
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
    this.database.recoverInterruptedSessionOperations();
    this.reconcile();
    for (const session of this.database.listActiveSessions(this.idleTimeoutMs)) {
      if (session.status === "active" && transientRequester(session.requester)) {
        this.closeSessionInternal(session.id, "gateway_restarted_transient");
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
    this.database.pruneCommandRuns(new Date(Date.now() - this.commandRetentionMs).toISOString());
    this.database.pruneMetrics(new Date(Date.now() - this.metricRetentionMs).toISOString());
  }

  listSessions(): SessionRecord[] {
    return this.database.listActiveSessions(this.idleTimeoutMs);
  }

  getSession(sessionId: string, capabilityToken: string): SessionDetail | null {
    if (!this.database.sessionCapabilityMatches(sessionId, capabilityHash(capabilityToken))) {
      throw new GatewayOperationError(403, "InvalidSessionCapability", "会话能力令牌无效或已失效");
    }
    return this.database.getSession(sessionId, this.idleTimeoutMs);
  }

  async prepareSshBinding(serverId: string): Promise<SshBindingResult> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");

    if (server.credentialRef) {
      try {
        this.ssh.credentialStore.pathFor(server);
      } catch (error) {
        const message = error instanceof CredentialError ? error.message : "网关凭据不可用";
        throw new GatewayOperationError(409, "CredentialUnavailable", message);
      }
      return {
        server,
        binding: {
          status: "bound",
          canTest: true,
          publicKey: null,
          installCommand: null,
          message: "这台 VPS 已关联网关凭据。可执行一次无交互测试，以确认连接并登记主机指纹。"
        }
      };
    }

    try {
      const generated = await this.ssh.credentialStore.ensureGeneratedCredential(server.id);
      this.database.audit("server.ssh.binding.prepared", "server", server.id, `已准备 SSH 绑定：${server.name}`, "info", {
        serverId: server.id,
        sshUser: server.sshUser
      });
      return {
        server,
        binding: {
          status: "pending",
          canTest: true,
          publicKey: generated.publicKey,
          installCommand: buildSshBootstrapCommand(generated.publicKey),
          message: "网关已在本机生成专属密钥。请在 VPS 的线上终端安装公钥后测试连接。"
        }
      };
    } catch (error) {
      const message = error instanceof CredentialError ? error.message : "无法准备 SSH 绑定";
      throw new GatewayOperationError(422, "SshBindingPreparationFailed", message);
    }
  }

  async testSshBinding(serverId: string): Promise<SshBindingResult> {
    const pending = this.bindingTasks.get(serverId);
    if (pending) return pending;

    const task = this.performSshBindingTest(serverId).finally(() => this.bindingTasks.delete(serverId));
    this.bindingTasks.set(serverId, task);
    return task;
  }

  private async performSshBindingTest(serverId: string): Promise<SshBindingResult> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    const conflictingSession = this.database.listActiveSessions(this.idleTimeoutMs).find((session) => session.serverId === server.id);
    if (conflictingSession) {
      throw new GatewayOperationError(409, "ServerBusy", "服务器当前已有 AI 会话，不能同时执行 SSH 绑定测试", {
        sessionId: conflictingSession.id,
        status: conflictingSession.status
      });
    }

    let candidate = server;
    let binding: SshBindingInfo;
    if (server.credentialRef) {
      try {
        this.ssh.credentialStore.pathFor(server);
      } catch (error) {
        const message = error instanceof CredentialError ? error.message : "网关凭据不可用";
        throw new GatewayOperationError(409, "CredentialUnavailable", message);
      }
      binding = {
        status: "bound",
        canTest: true,
        publicKey: null,
        installCommand: null,
        message: "已验证网关凭据与 SSH 连接。"
      };
    } else {
      const prepared = await this.prepareSshBinding(server.id);
      if (!prepared.binding.publicKey || !prepared.server) {
        throw new GatewayOperationError(409, "CredentialUnavailable", "未找到待绑定的网关凭据");
      }
      const generated = await this.ssh.credentialStore.ensureGeneratedCredential(server.id);
      candidate = { ...server, credentialRef: generated.credentialRef };
      binding = prepared.binding;
    }

    let result;
    try {
      result = await this.ssh.execute(candidate, "true", 20_000, { hostKeyPolicy: "accept-new" });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "本机 SSH 客户端不可用";
      this.database.audit("server.ssh.binding.failed", "server", server.id, `SSH 绑定测试失败：${server.name}`, "warning", {
        serverId: server.id,
        detail: redactText(detail, 1_000).value
      });
      throw new GatewayOperationError(422, "SshBindingFailed", `SSH 绑定失败：${detail}`);
    }

    if (result.timedOut || result.exitCode !== 0) {
      const detail = sshBindingErrorDetail(result);
      this.database.audit("server.ssh.binding.failed", "server", server.id, `SSH 绑定测试失败：${server.name}`, "warning", {
        serverId: server.id,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        detail
      });
      throw new GatewayOperationError(422, "SshBindingFailed", `SSH 绑定失败：${detail}。请确认公钥已写入 ${server.sshUser} 用户的 authorized_keys。`);
    }

    const updated = server.credentialRef
      ? this.database.getServer(server.id)
      : this.database.updateServer(server.id, { credentialRef: candidate.credentialRef });
    if (!updated) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    this.database.audit("server.ssh.bound", "server", server.id, `SSH 绑定成功：${server.name}`, "info", {
      serverId: server.id,
      sshUser: updated.sshUser,
      hostKeyPolicy: "accept-new"
    });
    return {
      server: updated,
      binding: {
        ...binding,
        status: "bound",
        canTest: false,
        publicKey: null,
        installCommand: null,
        message: "SSH 已验证。后续网关连接会严格校验本次登记的主机指纹。"
      }
    };
  }

  deleteServerRecord(serverId: string): { deleted: true; serverId: string; credentialRemoved: boolean } {
    const server = this.database.getServer(serverId, true);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    const linkedProjects = this.database.projectsForServer(serverId, true);
    if (linkedProjects.length) {
      throw new GatewayOperationError(409, "ServerHasProjects", "VPS“" + server.name + "”仍关联 " + linkedProjects.length + " 个项目，先完成项目清理后再删除", {
        projects: linkedProjects
      });
    }
    const openSessions = this.database.listActiveSessions(this.idleTimeoutMs).filter((session) => session.serverId === serverId);
    if (openSessions.length) {
      throw new GatewayOperationError(409, "ServerHasSessions", "VPS“" + server.name + "”仍有活动或排队会话，请先释放会话", {
        sessions: openSessions.map((session) => session.id)
      });
    }
    const result = this.database.deleteServer(serverId);
    if (!result.deleted) throw new GatewayOperationError(409, "ServerDeleteConflict", "VPS 删除条件在操作期间发生变化");
    let credentialRemoved = false;
    try {
      credentialRemoved = this.ssh.credentialStore.removeGeneratedCredential(server);
    } catch {
      this.database.audit("server.credential.cleanup_failed", "server", serverId, "VPS 删除后网关自动凭据清理失败：" + server.name, "critical");
    }
    this.database.audit("server.deleted", "server", serverId, "删除 VPS：" + server.name, "critical", {
      credentialRemoved
    });
    return { deleted: true, serverId, credentialRemoved };
  }

  openSession(serverId: string, requester?: string): SessionLease {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    try {
      this.ssh.credentialStore.pathFor(server);
    } catch (error) {
      const message = error instanceof CredentialError ? error.message : "网关凭据不可用";
      throw new GatewayOperationError(409, "CredentialUnavailable", message);
    }
    if (!this.ssh.credentialStore.hasKnownHosts()) {
      throw new GatewayOperationError(409, "KnownHostsUnavailable", "本机没有可用的 SSH known_hosts，先完成主机指纹登记");
    }
    const capabilityToken = newCapabilityToken();
    const session = this.database.openSession(
      serverId,
      requesterName(requester),
      capabilityHash(capabilityToken),
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
    return { session, capabilityToken };
  }

  closeSession(sessionId: string, capabilityToken: string, reason = "closed_by_operator"): { session: SessionRecord; promoted: SessionRecord | null } {
    if (!this.database.sessionCapabilityMatches(sessionId, capabilityHash(capabilityToken))) {
      throw new GatewayOperationError(403, "InvalidSessionCapability", "会话能力令牌无效或已失效");
    }
    const current = this.database.getSession(sessionId, this.idleTimeoutMs);
    if (current?.operationInFlight) {
      throw new GatewayOperationError(409, "SessionOperationInFlight", "会话仍有远程操作执行中，完成后才能释放");
    }
    return this.closeSessionInternal(sessionId, reason);
  }

  private closeSessionInternal(sessionId: string, reason: string): { session: SessionRecord; promoted: SessionRecord | null } {
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
    this.database.audit("server.emergency_root.revoked", "server", serverId, `关闭 root 救援提示：${server.name}`, "warning", {
      serverId,
      sessionsRemainUsable: true
    });
    return updated;
  }

  private acquireSessionOperation(sessionId: string, capabilityToken: string): SessionRecord {
    const acquired = this.database.acquireSessionOperation(sessionId, capabilityHash(capabilityToken), this.idleTimeoutMs);
    if (acquired.status === "acquired") return acquired.session;
    if (acquired.status === "not_found") throw new GatewayOperationError(404, "NotFound", "未找到会话");
    if (acquired.status === "unauthorized") throw new GatewayOperationError(403, "InvalidSessionCapability", "会话能力令牌无效或已失效");
    if (acquired.status === "busy") throw new GatewayOperationError(409, "SessionOperationInFlight", "该会话已有远程操作执行中，请等待完成");
    throw new GatewayOperationError(409, "SessionNotActive", acquired.session?.status === "queued" ? "会话仍在排队，当前 VPS 由其他会话占用" : "会话已结束，不能继续执行操作", {
      session: acquired.session
    });
  }

  async runCommand(sessionId: string, capabilityToken: string, command: string, timeoutMs?: number): Promise<CommandExecutionResult> {
    const session = this.acquireSessionOperation(sessionId, capabilityToken);
    const server = this.database.getServer(session.serverId);
    try {
      if (!server) throw new GatewayOperationError(404, "NotFound", "会话对应的 VPS 不存在");
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
          commandRunId: record.id,
          risk: assessment.risk,
          signals: assessment.signals,
          reason: assessment.reason
        });
        return { ...record, blockedReason: assessment.reason };
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
        error = caught instanceof Error ? redactText(caught.message, 2_000).value : "SSH 执行失败";
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
        commandRunId: record.id,
        risk: assessment.risk,
        signals: assessment.signals,
        outcome,
        exitCode,
        durationMs
      });
      return { ...record, blockedReason: null };
    } finally {
      this.database.releaseSessionOperation(sessionId, this.idleTimeoutMs);
    }
  }

  async collectMetrics(serverId: string, sessionId?: string, capabilityToken?: string, requester = "metrics"): Promise<MetricSnapshot> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    const previousMetric = this.database.latestMetric(serverId);
    let temporarySession: SessionRecord | null = null;
    let operationSessionId: string | null = null;
    let temporaryCapabilityToken: string | null = null;
    if (sessionId) {
      if (!capabilityToken) throw new GatewayOperationError(403, "MissingSessionCapability", "缺少会话能力令牌");
      const session = this.acquireSessionOperation(sessionId, capabilityToken);
      if (session.serverId !== serverId) {
        this.database.releaseSessionOperation(sessionId, this.idleTimeoutMs);
        throw new GatewayOperationError(409, "SessionMismatch", "会话与 VPS 不匹配");
      }
      operationSessionId = sessionId;
    } else {
      try {
        this.ssh.credentialStore.pathFor(server);
        if (!this.ssh.credentialStore.hasKnownHosts()) throw new Error("本机没有可用的 SSH known_hosts");
      } catch (error) {
        const note = error instanceof Error ? error.message : "网关凭据不可用";
        const metric = unavailableMetric(serverId, note);
        this.database.saveMetric(metric);
        recordMetricAlerts(this.database, server, previousMetric, metric);
        return metric;
      }
      temporaryCapabilityToken = newCapabilityToken();
      temporarySession = this.database.openSession(serverId, requesterName(requester), capabilityHash(temporaryCapabilityToken), this.idleTimeoutMs, 5 * 60_000, false);
      if (!temporarySession) {
        const metric = unavailableMetric(serverId, "服务器当前已有会话占用，稍后重试性能采集");
        this.database.saveMetric(metric);
        recordMetricAlerts(this.database, server, previousMetric, metric);
        return metric;
      }
      this.acquireSessionOperation(temporarySession.id, temporaryCapabilityToken);
      operationSessionId = temporarySession.id;
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
      if (operationSessionId) this.database.releaseSessionOperation(operationSessionId, this.idleTimeoutMs);
      if (temporarySession) this.closeSessionInternal(temporarySession.id, "metrics_completed");
    }
  }

  async collectInventory(serverId: string, sessionId?: string, capabilityToken?: string, requester = "inventory"): Promise<ServerInventory> {
    const server = this.database.getServer(serverId);
    if (!server) throw new GatewayOperationError(404, "NotFound", "未找到 VPS");
    let temporarySession: SessionRecord | null = null;
    let operationSessionId: string | null = null;
    let temporaryCapabilityToken: string | null = null;
    if (sessionId) {
      if (!capabilityToken) throw new GatewayOperationError(403, "MissingSessionCapability", "缺少会话能力令牌");
      const session = this.acquireSessionOperation(sessionId, capabilityToken);
      if (session.serverId !== serverId) {
        this.database.releaseSessionOperation(sessionId, this.idleTimeoutMs);
        throw new GatewayOperationError(409, "SessionMismatch", "会话与 VPS 不匹配");
      }
      operationSessionId = sessionId;
    } else {
      try {
        this.ssh.credentialStore.pathFor(server);
        if (!this.ssh.credentialStore.hasKnownHosts()) throw new Error("本机没有可用的 SSH known_hosts");
      } catch (error) {
        throw new GatewayOperationError(409, "InventoryUnavailable", error instanceof Error ? error.message : "网关凭据不可用");
      }
      temporaryCapabilityToken = newCapabilityToken();
      temporarySession = this.database.openSession(serverId, requesterName(requester), capabilityHash(temporaryCapabilityToken), this.idleTimeoutMs, 5 * 60_000, false);
      if (!temporarySession) throw new GatewayOperationError(409, "ServerBusy", "服务器当前已有会话占用，请稍后盘点");
      this.acquireSessionOperation(temporarySession.id, temporaryCapabilityToken);
      operationSessionId = temporarySession.id;
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
      if (operationSessionId) this.database.releaseSessionOperation(operationSessionId, this.idleTimeoutMs);
      if (temporarySession) this.closeSessionInternal(temporarySession.id, "inventory_completed");
    }
  }
}
