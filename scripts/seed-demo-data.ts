import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { GatewayDatabase } from "../server/db.js";
import type { MetricSnapshot, ProbeResult, ServerStatus } from "../server/types.js";

function outputDirectory(): string {
  const outputIndex = process.argv.indexOf("--output");
  const value = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!value) throw new Error("必须通过 --output 指定一个新的演示数据目录");
  const directory = resolve(value);
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`演示数据目录不是空目录：${directory}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function timestamp(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60_000).toISOString();
}

function markServer(
  database: GatewayDatabase,
  serverId: string,
  status: ServerStatus,
  probe: ProbeResult,
  error: string | null = null
): void {
  const checkedAt = timestamp(0.15);
  database.updateProbe(serverId, status, checkedAt, error);
  database.addHealthEvent(serverId, checkedAt, status, [probe], error);
}

function addMetricHistory(
  database: GatewayDatabase,
  serverId: string,
  points: Array<Pick<MetricSnapshot, "cpuPercent" | "memoryPercent" | "diskPercent" | "load1">>
): void {
  points.forEach((point, index) => {
    database.saveMetric({
      serverId,
      collectedAt: timestamp((points.length - index) * 0.5),
      source: "ssh",
      note: null,
      ...point
    });
  });
}

const directory = outputDirectory();
const database = new GatewayDatabase(directory);

try {
  const application = database.createServer({
    name: "东京应用节点",
    address: "203.0.113.10",
    sshPort: 22,
    sshUser: "ops",
    networkMode: "direct",
    role: "Web / API",
    environment: "production",
    tags: ["docker", "primary"],
    healthChecks: [{
      name: "Public HTTPS",
      kind: "http",
      config: { url: "https://app.example.test", expectedStatusCodes: [200], networkMode: "system" }
    }]
  });
  const databaseServer = database.createServer({
    name: "法兰克福数据节点",
    address: "198.51.100.20",
    sshPort: 2222,
    sshUser: "ops",
    networkMode: "direct",
    role: "PostgreSQL / Backup",
    environment: "production",
    tags: ["database", "backup"]
  });
  const edge = database.createServer({
    name: "新加坡边缘节点",
    address: "192.0.2.30",
    sshPort: 22,
    sshUser: "root",
    networkMode: "direct",
    role: "Reverse proxy",
    environment: "production",
    tags: ["nginx", "edge"]
  });
  const staging = database.createServer({
    name: "测试环境",
    address: "203.0.113.40",
    sshPort: 22,
    sshUser: "deploy",
    networkMode: "direct",
    role: "Staging",
    environment: "staging",
    tags: ["docker", "staging"]
  });

  markServer(database, application.id, "healthy", {
    kind: "http",
    name: "Public HTTPS",
    ok: true,
    latencyMs: 84,
    detail: "HTTP 200",
    statusCode: 200
  });
  markServer(database, databaseServer.id, "healthy", {
    kind: "ssh_banner",
    name: "SSH 2222",
    ok: true,
    latencyMs: 126,
    detail: "SSH banner received"
  });
  markServer(database, edge.id, "degraded", {
    kind: "http",
    name: "Public HTTPS",
    ok: false,
    latencyMs: 412,
    detail: "HTTP 502",
    statusCode: 502
  }, "公开入口返回 HTTP 502");

  addMetricHistory(database, application.id, [
    { cpuPercent: 21, memoryPercent: 48, diskPercent: 39, load1: 0.35 },
    { cpuPercent: 34, memoryPercent: 52, diskPercent: 39, load1: 0.62 },
    { cpuPercent: 29, memoryPercent: 51, diskPercent: 40, load1: 0.48 },
    { cpuPercent: 43, memoryPercent: 56, diskPercent: 40, load1: 0.77 },
    { cpuPercent: 31, memoryPercent: 54, diskPercent: 40, load1: 0.51 }
  ]);
  addMetricHistory(database, databaseServer.id, [
    { cpuPercent: 15, memoryPercent: 64, diskPercent: 58, load1: 0.28 },
    { cpuPercent: 19, memoryPercent: 66, diskPercent: 58, load1: 0.31 },
    { cpuPercent: 24, memoryPercent: 68, diskPercent: 59, load1: 0.44 },
    { cpuPercent: 18, memoryPercent: 67, diskPercent: 59, load1: 0.33 },
    { cpuPercent: 22, memoryPercent: 69, diskPercent: 59, load1: 0.41 }
  ]);
  addMetricHistory(database, edge.id, [
    { cpuPercent: 38, memoryPercent: 41, diskPercent: 33, load1: 0.54 },
    { cpuPercent: 56, memoryPercent: 47, diskPercent: 33, load1: 0.81 },
    { cpuPercent: 73, memoryPercent: 52, diskPercent: 34, load1: 1.12 },
    { cpuPercent: 91, memoryPercent: 58, diskPercent: 34, load1: 1.48 },
    { cpuPercent: 94, memoryPercent: 61, diskPercent: 34, load1: 1.61 }
  ]);

  database.createProject({
    name: "Atlas Console",
    description: "面向团队的管理控制台与公开 API。",
    repositoryUrl: "https://github.com/example/atlas-console",
    repositoryPath: "/srv/atlas-console",
    technologyStack: ["Docker Compose", "Nginx", "Node.js", "PostgreSQL", "Vue"],
    webEndpoints: [{
      label: "管理控制台",
      url: "https://app.example.test",
      port: 443,
      serviceName: "atlas-web",
      notes: "Nginx -> atlas-web:3000",
      source: "manual"
    }],
    servers: [
      { serverId: application.id, role: "application" },
      { serverId: databaseServer.id, role: "database" }
    ],
    services: [
      { serverId: application.id, name: "atlas-web", manager: "docker", identifier: "atlas-web", port: 3000, portMappings: ["127.0.0.1:3000 -> 3000/tcp"], critical: true, notes: "应用容器" },
      { serverId: application.id, name: "nginx", manager: "docker", identifier: "atlas-nginx", port: 443, portMappings: ["0.0.0.0:443 -> 443/tcp"], critical: true, notes: "共享公开入口" },
      { serverId: databaseServer.id, name: "postgres", manager: "systemd", identifier: "postgresql.service", port: 5432, portMappings: ["内网: 5432/tcp"], critical: true, notes: "主数据库" }
    ],
    runbook: {
      overview: "Atlas Console 使用独立应用节点与数据库节点，公开入口由 Nginx 提供。",
      deployment: "构建镜像并更新 Compose；迁移数据库前创建快照；滚动重启应用容器。",
      verification: "检查容器健康、数据库迁移状态、HTTPS 入口和核心 API。",
      troubleshooting: "先看应用日志与 Nginx upstream，再检查数据库连接池和磁盘空间。",
      guardrails: "不得删除数据库卷；不得绕过网关并发操作；修改 443 路由前确认共享入口。"
    }
  });
  database.createProject({
    name: "Edge Relay",
    description: "公开站点的反向代理与 TLS 入口。",
    repositoryPath: "/etc/nginx",
    technologyStack: ["Nginx", "systemd"],
    webEndpoints: [{
      label: "状态页",
      url: "https://status.example.test",
      port: 443,
      serviceName: "nginx",
      notes: "公开状态入口",
      source: "manual"
    }],
    servers: [{ serverId: edge.id, role: "edge" }],
    services: [{ serverId: edge.id, name: "nginx", manager: "systemd", identifier: "nginx.service", port: 443, portMappings: ["0.0.0.0:443"], critical: true, notes: "共享 TLS 入口" }],
    runbook: {
      overview: "边缘节点承载 Nginx 路由与 TLS 终止。",
      deployment: "运行 nginx -t 后 reload，不直接覆盖已启用配置。",
      verification: "检查 HTTPS、证书有效期、上游连通性和 5xx 比例。",
      troubleshooting: "从 nginx error log、upstream 健康和 DNS 解析依次排查。",
      guardrails: "修改共享路由前列出受影响域名；禁止删除证书目录。"
    }
  });

  database.audit("metrics.alert", "server", edge.id, "性能告警：新加坡边缘节点 · CPU 高", "warning", {
    serverId: edge.id,
    signals: ["CPU 高"]
  });
  database.audit("command.completed", "session", null, "完成高危命令：东京应用节点", "warning", {
    commandRunId: "demo-command-run-nginx-reload",
    risk: "high"
  });
  database.audit("project.updated", "project", null, "更新项目档案：Atlas Console", "info");

  console.log(`演示数据已写入：${directory}`);
  console.log(`启动命令：ALLVPS_DISABLE_SCHEDULERS=1 ALLVPS_DATA_DIR=${JSON.stringify(directory)} npm run start`);
} finally {
  database.close();
}
