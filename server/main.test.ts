import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp, DEFAULT_ROOT_ACCESS_DURATION_MS } from "./main.js";
import { CredentialStore } from "./credentials.js";
import { GatewayDatabase } from "./db.js";
import { SshExecutor } from "./ssh.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("local API", () => {
  it("generates a gateway-owned SSH key, returns only public bootstrap data, and binds after a non-interactive test", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-ssh-binding-"));
    temporaryDirectories.push(directory);
    const credentialsDirectory = join(directory, "credentials");
    const knownHostsPath = join(directory, "known_hosts");
    const capturePath = join(directory, "ssh-arguments.txt");
    const fakeSshPath = join(directory, "fake-ssh.sh");
    writeFileSync(fakeSshPath, ["#!/bin/sh", `printf '%s' "$*" > ${capturePath}`].join("\n"));
    chmodSync(fakeSshPath, 0o755);

    const database = new GatewayDatabase(directory);
    const store = new CredentialStore(credentialsDirectory, knownHostsPath);
    const app = await buildApp(database, {
      operationOptions: {
        sshExecutor: new SshExecutor({ credentialStore: store, sshBinary: fakeSshPath, directInterface: "en0" })
      }
    });
    await app.ready();

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/servers",
      payload: { name: "首次绑定节点", address: "203.0.113.61", sshPort: 22, sshUser: "root", networkMode: "direct" }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as { server: { id: string; credentialRef: string | null } };
    assert.equal(created.server.credentialRef, null);

    const bootstrapResponse = await app.inject({ method: "POST", url: `/api/servers/${created.server.id}/ssh/bootstrap` });
    assert.equal(bootstrapResponse.statusCode, 200);
    const bootstrap = bootstrapResponse.json() as { binding: { status: string; canTest: boolean; publicKey: string | null; installCommand: string | null } };
    assert.equal(bootstrap.binding.status, "pending");
    assert.equal(bootstrap.binding.canTest, true);
    assert.match(bootstrap.binding.publicKey ?? "", /^ssh-ed25519 /);
    assert.match(bootstrap.binding.installCommand ?? "", /authorized_keys/);
    assert.equal(database.getServer(created.server.id)?.credentialRef, null);
    const generatedReference = `gateway-generated-${created.server.id}.ed25519`;
    assert.equal(lstatSync(join(credentialsDirectory, generatedReference)).mode & 0o777, 0o600);

    const testResponse = await app.inject({ method: "POST", url: `/api/servers/${created.server.id}/ssh/test` });
    assert.equal(testResponse.statusCode, 200);
    const bound = testResponse.json() as { server: { credentialRef: string | null }; binding: { status: string; canTest: boolean; publicKey: string | null; installCommand: string | null } };
    assert.equal(bound.binding.status, "bound");
    assert.equal(bound.binding.canTest, false);
    assert.equal(bound.binding.publicKey, null);
    assert.equal(bound.binding.installCommand, null);
    assert.equal(bound.server.credentialRef, generatedReference);
    assert.equal(store.hasKnownHosts(), true);
    const sshArguments = readFileSync(capturePath, "utf8");
    assert.match(sshArguments, /StrictHostKeyChecking=accept-new/);
    assert.match(sshArguments, /ProxyCommand=none/);
    const existingCredentialResponse = await app.inject({ method: "POST", url: `/api/servers/${created.server.id}/ssh/bootstrap` });
    assert.equal(existingCredentialResponse.statusCode, 200);
    assert.equal(existingCredentialResponse.json().binding.canTest, true);
    assert.equal(database.recentAudit().some((event) => event.action === "server.ssh.bound"), true);
    await app.close();
  });

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

  it("requires remote cleanup confirmation and protects VPS project associations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-delete-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database);
    await app.ready();

    const serverResponse = await app.inject({
      method: "POST",
      url: "/api/servers",
      payload: { name: "待删除节点", address: "203.0.113.32", sshPort: 22, sshUser: "ubuntu" }
    });
    const server = serverResponse.json() as { server: { id: string } };
    const projectResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "待清理项目",
        description: "删除流程测试",
        servers: [{ serverId: server.server.id, role: "primary" }],
        services: [{ serverId: server.server.id, name: "test-service", manager: "systemd", identifier: "test.service" }]
      }
    });
    const project = projectResponse.json() as { project: { id: string } };

    const detailResponse = await app.inject({ method: "GET", url: "/api/servers/" + server.server.id });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().linkedProjects.length, 1);
    const blockedServerDelete = await app.inject({
      method: "POST",
      url: "/api/servers/" + server.server.id + "/delete",
      payload: { confirmed: true }
    });
    assert.equal(blockedServerDelete.statusCode, 409);
    assert.equal(blockedServerDelete.json().error, "ServerHasProjects");

    const invalidProjectDelete = await app.inject({
      method: "POST",
      url: "/api/projects/" + project.project.id + "/delete",
      payload: { cleanupConfirmed: false, cleanupSummary: "未完成" }
    });
    assert.equal(invalidProjectDelete.statusCode, 400);

    const projectDelete = await app.inject({
      method: "POST",
      url: "/api/projects/" + project.project.id + "/delete",
      payload: { cleanupConfirmed: true, cleanupSummary: "已停止并验证 test.service，确认远程项目服务不存在。" }
    });
    assert.equal(projectDelete.statusCode, 200);
    assert.equal(projectDelete.json().deleted, true);

    const serverDelete = await app.inject({
      method: "POST",
      url: "/api/servers/" + server.server.id + "/delete",
      payload: { confirmed: true }
    });
    assert.equal(serverDelete.statusCode, 200);
    assert.equal(serverDelete.json().deleted, true);
    assert.equal(database.getServer(server.server.id, true), null);
    assert.equal(database.getProject(project.project.id, true), null);
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
