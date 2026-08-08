import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const apiBaseUrl = process.env.ALLVPS_API_URL ?? "http://127.0.0.1:4318";

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`本机网关返回 HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : "读取本机网关失败" }]
  };
}

const server = new McpServer({ name: "ai-vps-gateway", version: "0.1.0" });

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

await server.connect(new StdioServerTransport());
