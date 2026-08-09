import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp, DEFAULT_ROOT_ACCESS_DURATION_MS } from "./main.js";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local API", () => {
  it("creates and archives a server through the manual management API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database);
    await app.ready();

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/servers",
      payload: {
        name: "API 测试节点",
        address: "203.0.113.11",
        sshPort: 22,
        sshUser: "ubuntu",
        role: "Web",
        tags: ["test"],
        healthChecks: []
      }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as { server: { id: string } };

    const routeResponse = await app.inject({
      method: "PATCH",
      url: `/api/servers/${created.server.id}`,
      payload: { networkMode: "direct" }
    });
    assert.equal(routeResponse.statusCode, 200);
    assert.equal(routeResponse.json().server.networkMode, "direct");
    assert.equal(routeResponse.json().server.sshUser, "ubuntu");
    assert.deepEqual(routeResponse.json().server.tags, ["test"]);

    const listResponse = await app.inject({ method: "GET", url: "/api/servers" });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().servers.length, 1);

    const archiveResponse = await app.inject({ method: "POST", url: `/api/servers/${created.server.id}/archive` });
    assert.equal(archiveResponse.statusCode, 200);
    assert.equal(archiveResponse.json().archived, true);

    await app.close();
  });

  it("previews and applies the fixed all-vps document source", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-sync-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "all-vps");
    mkdirSync(sourceDirectory);
    writeFileSync(join(sourceDirectory, "VPS_INVENTORY.md"), `# 清单\n\n| 节点 | SSH | 系统与资源 | 主要运行内容 | 主机可见公网监听 |\n| --- | --- | --- | --- | --- |\n| 同步测试 | \`ubuntu@203.0.113.12:22\` | Ubuntu | Nginx | \`22\`、\`443\` |\n`);
    writeFileSync(join(sourceDirectory, "DOMAINS.md"), "# 域名\n");

    const database = new GatewayDatabase(directory);
    const app = await buildApp(database, {
      allVpsSourcePaths: {
        directory: sourceDirectory,
        inventoryPath: join(sourceDirectory, "VPS_INVENTORY.md"),
        domainsPath: join(sourceDirectory, "DOMAINS.md")
      }
    });
    await app.ready();

    const previewResponse = await app.inject({ method: "GET", url: "/api/sync/all-vps/preview" });
    assert.equal(previewResponse.statusCode, 200);
    const preview = previewResponse.json() as { source: { digest: string }; summary: { created: number } };
    assert.equal(preview.summary.created, 1);

    const staleResponse = await app.inject({
      method: "POST",
      url: "/api/sync/all-vps",
      payload: { sourceDigest: "0".repeat(64) }
    });
    assert.equal(staleResponse.statusCode, 409);

    const applyResponse = await app.inject({
      method: "POST",
      url: "/api/sync/all-vps",
      payload: { sourceDigest: preview.source.digest }
    });
    assert.equal(applyResponse.statusCode, 200);
    assert.equal(database.listServers().length, 1);
    assert.equal(database.listServers()[0]?.source, "all-vps");

    await app.close();
  });

  it("manages a project and its runbook through the local API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-project-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database);
    await app.ready();

    const serverResponse = await app.inject({
      method: "POST",
      url: "/api/servers",
      payload: { name: "项目 API 节点", address: "203.0.113.30", sshPort: 22, sshUser: "ubuntu" }
    });
    const server = serverResponse.json() as { server: { id: string } };
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "API 项目",
        description: "测试项目",
        runbook: {
          overview: "项目入口",
          deployment: "发布步骤",
          verification: "验证步骤",
          troubleshooting: "排错步骤",
          guardrails: "保护边界"
        },
        servers: [{ serverId: server.server.id, role: "primary" }],
        services: [{ serverId: server.server.id, name: "web", manager: "docker", identifier: "web", critical: true }]
      }
    });
    assert.equal(createResponse.statusCode, 201);
    const project = createResponse.json() as { project: { id: string; serviceCount: number } };
    assert.equal(project.project.serviceCount, 1);

    const detailResponse = await app.inject({ method: "GET", url: `/api/projects/${project.project.id}` });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().project.runbook.guardrails, "保护边界");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.project.id}`,
      payload: { description: "更新后的测试项目" }
    });
    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().project.description, "更新后的测试项目");

    const archiveResponse = await app.inject({ method: "POST", url: `/api/projects/${project.project.id}/archive` });
    assert.equal(archiveResponse.statusCode, 200);
    assert.equal(database.listProjects().length, 0);
    await app.close();
  });

  it("serves metric history and performance alerts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-metrics-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database);
    await app.ready();
    const server = database.createServer({ name: "性能 API 节点", address: "203.0.113.31", sshPort: 22, sshUser: "ubuntu" });
    database.saveMetric({
      serverId: server.id,
      collectedAt: "2026-08-09T00:00:00.000Z",
      cpuPercent: 12,
      memoryPercent: 34,
      diskPercent: 45,
      load1: 0.2,
      source: "ssh",
      note: null
    });
    database.audit("metrics.alert", "server", server.id, "性能告警：性能 API 节点 · CPU 高", "warning", { serverId: server.id });

    const historyResponse = await app.inject({ method: "GET", url: `/api/servers/${server.id}/metrics/history?limit=10&hours=720` });
    assert.equal(historyResponse.statusCode, 200);
    assert.equal(historyResponse.json().metrics.length, 1);
    const alertsResponse = await app.inject({ method: "GET", url: "/api/alerts?limit=10" });
    assert.equal(alertsResponse.statusCode, 200);
    assert.equal(alertsResponse.json().alerts[0].summary, "性能告警：性能 API 节点 · CPU 高");
    await app.close();
  });

  it("records an optional WebUI emergency-root rescue marker for root SSH assets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-root-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database);
    await app.ready();

    const serverResponse = await app.inject({
      method: "POST",
      url: "/api/servers",
      payload: { name: "root 救援节点", address: "203.0.113.60", sshPort: 22, sshUser: "root" }
    });
    const server = serverResponse.json() as { server: { id: string; emergencyRootUntil: string | null } };
    assert.equal(server.server.emergencyRootUntil, null);

    const grantResponse = await app.inject({
      method: "POST",
      url: `/api/servers/${server.server.id}/emergency-root`,
      payload: {}
    });
    assert.equal(grantResponse.statusCode, 200);
    const grantedUntil = grantResponse.json().server.emergencyRootUntil as string;
    assert.ok(grantedUntil);
    assert.ok(Date.parse(grantedUntil) - Date.now() > DEFAULT_ROOT_ACCESS_DURATION_MS - 60_000);

    const revokeResponse = await app.inject({ method: "POST", url: `/api/servers/${server.server.id}/emergency-root/revoke` });
    assert.equal(revokeResponse.statusCode, 200);
    assert.equal(revokeResponse.json().server.emergencyRootUntil, null);
    assert.equal(database.recentAudit().some((event) => event.action === "server.emergency_root.granted"), true);
    await app.close();
  });
});
