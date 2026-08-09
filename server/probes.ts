import { createConnection } from "node:net";
import type { HealthCheck, ProbeResult, ProbeSummary, ServerRecord, ServerStatus } from "./types.js";
import { GatewayDatabase } from "./db.js";

const DEFAULT_TIMEOUT_MS = 3_000;

function elapsed(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function boundedTimeout(value: number | undefined): number {
  return Math.min(Math.max(value ?? DEFAULT_TIMEOUT_MS, 250), 10_000);
}

export function probeTcp(host: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const startedAt = Date.now();
  const timeout = boundedTimeout(timeoutMs);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout, () => finish({ kind: "tcp", name: `TCP ${host}:${port}`, ok: false, latencyMs: elapsed(startedAt), detail: `连接超时（${timeout} ms）` }));
    socket.once("connect", () => finish({ kind: "tcp", name: `TCP ${host}:${port}`, ok: true, latencyMs: elapsed(startedAt), detail: "端口可建立 TCP 连接" }));
    socket.once("error", (error: Error) => finish({ kind: "tcp", name: `TCP ${host}:${port}`, ok: false, latencyMs: elapsed(startedAt), detail: error.message }));
  });
}

export function probeSshBanner(host: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const startedAt = Date.now();
  const timeout = boundedTimeout(timeoutMs);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    let received = "";
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ kind: "ssh_banner", name: `SSH Banner ${host}:${port}`, ok, latencyMs: elapsed(startedAt), detail });
    };
    socket.setTimeout(timeout, () => finish(false, `未收到 SSH Banner（${timeout} ms）`));
    socket.once("error", (error: Error) => finish(false, error.message));
    socket.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      if (received.length > 4096) {
        finish(false, "响应超过探针限制，未找到 SSH Banner");
        return;
      }
      const banner = received.split(/\r?\n/).find((line) => line.startsWith("SSH-"));
      if (banner) finish(true, banner.trim());
    });
  });
}

export async function probeHttp(check: HealthCheck): Promise<ProbeResult> {
  const startedAt = Date.now();
  const url = check.config.url ?? "";
  const expected = check.config.expectedStatusCodes?.length ? check.config.expectedStatusCodes : [200];
  if (!/^https?:\/\//i.test(url)) {
    return { kind: "http", name: check.name, ok: false, latencyMs: elapsed(startedAt), detail: "URL 必须以 http:// 或 https:// 开头" };
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "ai-vps-gateway-health/0.1" },
      signal: AbortSignal.timeout(boundedTimeout(check.config.timeoutMs))
    });
    const ok = expected.includes(response.status);
    return {
      kind: "http",
      name: check.name,
      ok,
      latencyMs: elapsed(startedAt),
      detail: ok ? `HTTP ${response.status} 命中预期` : `HTTP ${response.status}，预期 ${expected.join(", ")}`,
      statusCode: response.status
    };
  } catch (error) {
    return { kind: "http", name: check.name, ok: false, latencyMs: elapsed(startedAt), detail: error instanceof Error ? error.message : "HTTP 请求失败" };
  }
}

async function runConfiguredCheck(check: HealthCheck, server: ServerRecord): Promise<ProbeResult> {
  if (check.kind === "http") return probeHttp(check);
  return probeTcp(check.config.host ?? server.address, check.config.port ?? server.sshPort, check.config.timeoutMs).then((result) => ({ ...result, kind: "tcp", name: check.name }));
}

function statusFor(results: ProbeResult[], hasConfiguredChecks: boolean): ServerStatus {
  const tcp = results.find((result) => result.kind === "tcp" && result.name.startsWith("TCP "));
  const ssh = results.find((result) => result.kind === "ssh_banner");
  const serviceResults = results.slice(2);
  const serviceFailure = serviceResults.some((result) => !result.ok);

  if (tcp && !tcp.ok) return hasConfiguredChecks && serviceResults.some((result) => result.ok) ? "ssh_unreachable" : "offline";
  if (ssh && !ssh.ok) return "ssh_unreachable";
  if (serviceFailure) return "degraded";
  return "healthy";
}

export async function probeServer(database: GatewayDatabase, server: ServerRecord): Promise<ProbeSummary> {
  const checkedAt = new Date().toISOString();
  if (server.maintenance) {
    const summary: ProbeSummary = { serverId: server.id, status: "maintenance", checkedAt, results: [], error: "服务器处于维护模式" };
    database.updateProbe(server.id, summary.status, checkedAt, summary.error);
    database.addHealthEvent(server.id, checkedAt, summary.status, [], summary.error);
    return summary;
  }

  const baselineTcp = await probeTcp(server.address, server.sshPort);
  const baselineSsh = baselineTcp.ok ? await probeSshBanner(server.address, server.sshPort) : {
    kind: "ssh_banner" as const,
    name: `SSH Banner ${server.address}:${server.sshPort}`,
    ok: false,
    latencyMs: baselineTcp.latencyMs,
    detail: "TCP 连接失败，跳过 SSH Banner"
  };
  const configuredChecks = server.healthChecks.filter((check) => check.enabled);
  const serviceResults = await Promise.all(configuredChecks.map((check) => runConfiguredCheck(check, server)));
  const results = [baselineTcp, baselineSsh, ...serviceResults];
  const status = statusFor(results, configuredChecks.length > 0);
  const failures = results.filter((result) => !result.ok).map((result) => `${result.name}: ${result.detail}`);
  const error = failures.length ? failures.slice(0, 3).join("；") : null;
  database.updateProbe(server.id, status, checkedAt, error);
  database.addHealthEvent(server.id, checkedAt, status, results, error);
  return { serverId: server.id, status, checkedAt, results, error };
}
