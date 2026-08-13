import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { gatewayApiToken, localGatewayBaseUrl, verifyGatewayIdentity } from "../server/auth.js";
import { sanitizeStructuredValue } from "../server/command-policy.js";

const apiBaseUrl = localGatewayBaseUrl();
const apiToken = gatewayApiToken();
const sessionCapabilities = new Map<string, string>();

async function apiRequest<T>(path: string, init?: RequestInit, sessionId?: string): Promise<T> {
  await verifyGatewayIdentity(apiBaseUrl, apiToken);
  const sessionCapability = sessionId ? sessionCapabilities.get(sessionId) : undefined;
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-ai-vps-gateway-token": apiToken,
      ...(sessionCapability ? { "x-ai-vps-session-token": sessionCapability } : {}),
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? `本机网关返回 HTTP ${response.status}`);
  }
  return payload as T;
}

async function apiGet<T>(path: string, sessionId?: string): Promise<T> {
  return apiRequest<T>(path, undefined, sessionId);
}

async function apiPost<T>(path: string, body: unknown, sessionId?: string): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body: JSON.stringify(body) }, sessionId);
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

function sanitizeMcpResult(value: unknown): unknown {
  return sanitizeStructuredValue(value);
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(sanitizeMcpResult(value), null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : "读取本机网关失败" }]
  };
}

const server = new McpServer({ name: "ai-vps-gateway", version: "0.1.2" });

const projectRunbookInput = z.object({
  overview: z.string().trim().max(12_000).default(""),
  deployment: z.string().trim().max(12_000).default(""),
  verification: z.string().trim().max(12_000).default(""),
  troubleshooting: z.string().trim().max(12_000).default(""),
  guardrails: z.string().trim().max(12_000).default("")
});
const projectServerInput = z.object({
  serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
  role: z.string().trim().max(80).default("")
});
const projectServiceInput = z.object({
  serverId: z.string().uuid().describe("必须是本项目已关联的 VPS UUID"),
  name: z.string().trim().min(1).max(100),
  manager: z.enum(["docker", "systemd", "process", "external"]),
  identifier: z.string().trim().min(1).max(160),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  portMappings: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
  accessUrl: z.string().url().nullable().optional(),
  critical: z.boolean().default(false),
  notes: z.string().trim().max(4_000).default("")
});
const projectEndpointInput = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().url(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  serviceName: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(1_000).default(""),
  source: z.enum(["manual", "remote-inventory"]).optional()
});

server.registerTool(
  "list_servers",
  {
    title: "List VPS inventory",
    description: "读取已在本机 AI VPS Gateway 中手动登记的 VPS 列表、状态和健康检查配置。不会执行远程命令。",
    annotations: { readOnlyHint: true }
  },
  async () => {
    try {
      return jsonResult(await apiGet("/api/servers"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "prepare_ssh_binding",
  {
    title: "Prepare SSH VPS binding",
    description: "为一台尚未绑定的 VPS 在本机网关生成专属 Ed25519 凭据，并返回可由用户粘贴到云厂商网页终端或现有 SSH 会话的一条公钥安装命令。只返回公钥，不会返回或读取私钥。用户完成线上安装后，再调用 test_ssh_binding。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID")
    }
  },
  async ({ serverId }) => {
    try {
      return jsonResult(await apiPost(`/api/servers/${serverId}/ssh/bootstrap`, {}));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "test_ssh_binding",
  {
    title: "Test and finish SSH VPS binding",
    description: "通过本机网关以 BatchMode 测试 SSH 公钥登录。首次成功连接时仅接受并保存该主机的新 SSH 指纹；之后的运维连接保持严格指纹校验。成功后自动关联网关凭据，AI 仍不会接触私钥。",
    inputSchema: {
      serverId: z.string().uuid().describe("已完成公钥安装的 VPS UUID")
    }
  },
  async ({ serverId }) => {
    try {
      return jsonResult(await apiPost(`/api/servers/${serverId}/ssh/test`, {}));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_sessions",
  {
    title: "List active VPS sessions",
    description: "读取当前活动和排队中的 VPS 会话。每台 VPS 同时只允许一个活动会话，其余会话按先来先服务排队。",
    annotations: { readOnlyHint: true }
  },
  async () => {
    try {
      return jsonResult(await apiGet("/api/sessions"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "open_session",
  {
    title: "Open VPS operations session",
    description: "向本机网关申请一台 VPS 的独占运维会话。网关负责检查逻辑凭据、SSH 主机指纹、租约和同机排队；AI 不会接触私钥。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
      requester: z.string().max(120).optional().describe("当前 AI 客户端或会话标识")
    }
  },
  async ({ serverId, requester }) => {
    try {
      const result = await apiPost<{ session: { id: string }; capabilityToken: string }>("/api/sessions", { serverId, requester });
      sessionCapabilities.set(result.session.id, result.capabilityToken);
      return jsonResult({ session: result.session });
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_session",
  {
    title: "Get VPS session",
    description: "读取会话租约状态和该会话已保存的脱敏命令执行记录。",
    inputSchema: { sessionId: z.string().uuid().describe("网关返回的会话 UUID") },
    annotations: { readOnlyHint: true }
  },
  async ({ sessionId }) => {
    try {
      return jsonResult(await apiGet(`/api/sessions/${sessionId}`, sessionId));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "run_command",
  {
    title: "Run remote command",
    description: "通过本机网关在已获得独占租约的 VPS 上执行 Shell 命令。默认允许运维操作；网关会标记高危命令、保存脱敏输出，并直接阻断根目录递归删除、块设备破坏、文件系统格式化和 fork bomb。",
    inputSchema: {
      sessionId: z.string().uuid().describe("必须是 active 状态的网关会话 UUID"),
      command: z.string().min(1).max(20_000).describe("要在远程 VPS 上执行的 Shell 命令"),
      timeoutMs: z.number().int().min(1_000).max(600_000).optional().describe("命令超时时间，单位毫秒")
    }
  },
  async ({ sessionId, command, timeoutMs }) => {
    try {
      return jsonResult(await apiPost(`/api/sessions/${sessionId}/commands`, { command, timeoutMs }, sessionId));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "close_session",
  {
    title: "Close VPS session",
    description: "释放 VPS 运维会话租约，并让该 VPS 上最早排队的会话获得执行机会。",
    inputSchema: {
      sessionId: z.string().uuid().describe("网关返回的会话 UUID"),
      reason: z.string().max(120).optional().describe("关闭原因")
    }
  },
  async ({ sessionId, reason }) => {
    try {
      const result = await apiPost(`/api/sessions/${sessionId}/close`, { reason }, sessionId);
      sessionCapabilities.delete(sessionId);
      return jsonResult(result);
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "collect_metrics",
  {
    title: "Collect VPS metrics",
    description: "通过 SSH 采集当前 CPU、内存、根盘和 load 1m 快照。传入 active 会话时复用该租约；不传会话时仅在 VPS 空闲时使用短暂内部租约。没有逻辑凭据时返回明确的 unavailable 状态。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
      sessionId: z.string().uuid().optional().describe("可选的 active 网关会话 UUID")
    }
  },
  async ({ serverId, sessionId }) => {
    try {
      return jsonResult(await apiPost(`/api/servers/${serverId}/metrics`, { sessionId }, sessionId));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "collect_all_metrics",
  {
    title: "Collect all VPS metrics",
    description: "依次通过本机网关采集所有未归档、已登记 VPS（包括手动添加和 all-vps 同步资产）的当前 CPU、内存、根盘和 load 1m 快照。每台 VPS 使用短暂内部租约，不会绕过其他 AI 会话的独占锁。",
    annotations: { destructiveHint: false }
  },
  async () => {
    try {
      return jsonResult(await apiPost("/api/metrics/all", {}));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_metric_history",
  {
    title: "Get VPS metric history",
    description: "读取一台 VPS 最近保存的 CPU、内存、根盘和 load 1m 性能快照，用于判断短期趋势。不会执行远程命令。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
      limit: z.number().int().min(1).max(240).optional().describe("最多读取多少个快照，默认 48"),
      hours: z.number().int().min(1).max(720).optional().describe("保留最近多少小时的数据，默认 168" )
    },
    annotations: { readOnlyHint: true }
  },
  async ({ serverId, limit, hours }) => {
    try {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set("limit", String(limit));
      if (hours !== undefined) query.set("hours", String(hours));
      return jsonResult(await apiGet(`/api/servers/${serverId}/metrics/history${query.size ? `?${query}` : ""}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_metric_alerts",
  {
    title: "List performance alerts",
    description: "读取性能阈值告警。告警只在状态首次进入高 CPU、内存、磁盘或性能不可用时写入，恢复后再次进入会产生新记录。",
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe("最多读取多少条告警，默认 30") },
    annotations: { readOnlyHint: true }
  },
  async ({ limit }) => {
    try {
      return jsonResult(await apiGet(`/api/alerts?limit=${limit ?? 30}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "sync_server_projects",
  {
    title: "Inventory and sync VPS projects",
    description: "通过只读 SSH 盘点 Docker 容器、运行中的 systemd 服务、监听端口和常见项目清单，并同步为本机项目档案与 Runbook。不会读取环境变量、密钥或配置文件内容。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
      sessionId: z.string().uuid().optional().describe("可选的 active 网关会话 UUID")
    }
  },
  async ({ serverId, sessionId }) => {
    try {
      return jsonResult(await apiPost(`/api/servers/${serverId}/inventory/sync-projects`, { sessionId }, sessionId));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "sync_all_vps_projects",
  {
    title: "Inventory all VPS projects",
    description: "依次通过只读 SSH 盘点所有未归档、已登记 VPS（包括手动添加和 all-vps 同步资产）的 Docker、systemd、监听端口和常见项目清单，并更新本机项目档案与自动 Runbook。不会读取环境变量、密钥或配置内容。"
  },
  async () => {
    try {
      return jsonResult(await apiPost("/api/inventory/all-vps/sync-projects", {}));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_server",
  {
    title: "Get VPS details",
    description: "读取一台已登记 VPS 的元数据、最近健康检查和可用性能快照。不会执行远程命令。",
    inputSchema: { serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID") },
    annotations: { readOnlyHint: true }
  },
  async ({ serverId }) => {
    try {
      return jsonResult(await apiGet(`/api/servers/${serverId}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
 "get_dashboard",
 {
   title: "Get VPS dashboard",
   description: "读取本机网关的 VPS 健康汇总和资产状态。不会执行远程命令。",
   annotations: { readOnlyHint: true }
 },
 async () => {
   try {
     return jsonResult(await apiGet("/api/dashboard"));
   } catch (error) {
     return errorResult(error);
   }
 }
);

server.registerTool(
  "delete_server",
  {
    title: "Delete VPS record",
    description: "删除本机 VPS 记录及其本地历史数据。网关会强制检查该 VPS 没有任何活动或已归档项目关联、没有活动/排队会话；不会删除远程服务器内容。必须明确传 confirmed=true。all-vps 文档仍包含该资产时，后续同步可能重新导入。",
    inputSchema: {
      serverId: z.string().uuid().describe("AI VPS Gateway 中的 VPS UUID"),
      confirmed: z.literal(true).describe("必须明确确认删除")
    },
    annotations: { destructiveHint: true }
  },
  async ({ serverId, confirmed }) => {
    try {
      return jsonResult(await apiPost(`/api/servers/${serverId}/delete`, { confirmed }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "list_projects",
  {
    title: "List project runbooks",
    description: "读取本机项目档案摘要、技术栈、项目级 Web 入口、关联 VPS 数量、服务数量和关键服务数量。不会执行远程命令。",
    annotations: { readOnlyHint: true }
  },
  async () => {
    try {
      return jsonResult(await apiGet("/api/projects"));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "get_project",
  {
    title: "Get project runbook",
    description: "读取项目的技术栈、项目级 Web 入口、Runbook、关联 VPS、Docker/systemd/进程服务清单、端口映射、镜像/挂载备注和变更边界。不会执行远程命令。",
    inputSchema: { projectId: z.string().uuid().describe("AI VPS Gateway 中的项目 UUID") },
    annotations: { readOnlyHint: true }
  },
  async ({ projectId }) => {
    try {
      return jsonResult(await apiGet(`/api/projects/${projectId}`));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
  "create_project",
  {
    title: "Create local project runbook",
    description: "在本机 AI VPS Gateway 新建项目档案和五段 Runbook；不会执行远程命令或写入 VPS。Web 入口只能是项目站点地址，不能填写 VPS SSH 连接地址。",
    inputSchema: {
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(2_000).default(""),
      repositoryUrl: z.string().url().nullable().optional(),
      repositoryPath: z.string().trim().min(1).max(320).nullable().optional(),
      technologyStack: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
      webEndpoints: z.array(projectEndpointInput).max(100).default([]),
      runbook: projectRunbookInput.default({ overview: "", deployment: "", verification: "", troubleshooting: "", guardrails: "" }),
      servers: z.array(projectServerInput).max(30).default([]),
      services: z.array(projectServiceInput).max(100).default([])
    }
  },
  async (input) => {
    try {
      return jsonResult(await apiPost("/api/projects", input));
    } catch (error) {
      return errorResult(error);
    }
  }
);

server.registerTool(
 "update_project",
 {
   title: "Update local project runbook",
   description: "更新本机项目档案或 Runbook；不会执行远程命令或写入 VPS。提交 servers、services 或 webEndpoints 时会替换该完整列表，操作前应先 get_project 保留已有记录。",
   inputSchema: {
     projectId: z.string().uuid().describe("AI VPS Gateway 中的项目 UUID"),
     name: z.string().trim().min(1).max(100).optional(),
     description: z.string().trim().max(2_000).optional(),
     repositoryUrl: z.string().url().nullable().optional(),
     repositoryPath: z.string().trim().min(1).max(320).nullable().optional(),
     technologyStack: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
     webEndpoints: z.array(projectEndpointInput).max(100).optional(),
     runbook: projectRunbookInput.optional(),
     servers: z.array(projectServerInput).max(30).optional(),
     services: z.array(projectServiceInput).max(100).optional()
   }
 },
 async ({ projectId, ...input }) => {
   try {
     return jsonResult(await apiPatch(`/api/projects/${projectId}`, input));
   } catch (error) {
     return errorResult(error);
   }
 }
);

server.registerTool(
  "delete_project",
  {
    title: "Delete project record after remote cleanup",
    description: "删除本机项目记录、Runbook、项目服务和 VPS 关联。此工具不会清理远程服务器；Agent 必须先通过网关会话完成并验证远程清理，再明确传 cleanupConfirmed=true 和中文 cleanupSummary。",
    inputSchema: {
      projectId: z.string().uuid().describe("AI VPS Gateway 中的项目 UUID"),
      cleanupConfirmed: z.literal(true).describe("必须确认远程服务已清理并验证"),
      cleanupSummary: z.string().trim().min(20).max(4_000).describe("远程清理的服务、配置、验证结果和残留风险；不要写入密码、Token 或私钥")
    },
    annotations: { destructiveHint: true }
  },
  async ({ projectId, cleanupConfirmed, cleanupSummary }) => {
    try {
      return jsonResult(await apiPost(`/api/projects/${projectId}/delete`, { cleanupConfirmed, cleanupSummary }));
    } catch (error) {
      return errorResult(error);
    }
  }
);

export async function startMcpServer(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void startMcpServer().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
