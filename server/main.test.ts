import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { gatewayHealthProof } from "./auth.js";
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
  it("can disable background network schedulers for an isolated demo database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-no-schedulers-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "离线演示节点", address: "203.0.113.90", sshPort: 22, sshUser: "ops" });
    const checkedAt = "2026-08-12T00:00:00.000Z";
    database.updateProbe(server.id, "healthy", checkedAt, null);
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
    await app.ready();
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(database.getServer(server.id)?.status, "healthy");
    assert.equal(database.getServer(server.id)?.lastCheckedAt, checkedAt);
    await app.close();
  });

  it("authenticates local API callers and rejects untrusted hosts and origins", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-auth-"));
    temporaryDirectories.push(directory);
    const staticDirectory = join(directory, "web");
    mkdirSync(staticDirectory);
    writeFileSync(join(staticDirectory, "index.html"), "<!doctype html><title>Gateway</title>");
    const token = "a".repeat(43);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database, { apiToken: token, disableSchedulers: true, staticDirectory });
    await app.ready();

    const unauthenticated = await app.inject({ method: "GET", url: "/api/servers" });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.headers["cache-control"], "no-store");

    const authenticated = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(authenticated.statusCode, 200);

    const publicPage = await app.inject({
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1:4318" }
    });
    assert.equal(publicPage.statusCode, 200);
    assert.equal(publicPage.headers["set-cookie"], undefined);
    assert.match(String(publicPage.headers["content-security-policy"]), /default-src 'self'/);
    const page = await app.inject({
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1:4318", "x-ai-vps-gateway-token": token }
    });
    assert.equal(page.statusCode, 200);
    const cookie = page.headers["set-cookie"];
    assert.equal(typeof cookie, "string");
    assert.match(String(cookie), /HttpOnly; SameSite=Strict; Path=\/api/);
    const cookieAuthenticated = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "127.0.0.1:4318", cookie: String(cookie).split(";")[0] }
    });
    assert.equal(cookieAuthenticated.statusCode, 200);

    const rejectedHost = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "gateway.example.test", authorization: `Bearer ${token}` }
    });
    assert.equal(rejectedHost.statusCode, 421);

    const rejectedOrigin = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "127.0.0.1:4318", origin: "https://attacker.example.test", authorization: `Bearer ${token}` }
    });
    assert.equal(rejectedOrigin.statusCode, 403);

    const allowedDevelopmentOrigin = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { host: "127.0.0.1:4318", origin: "http://localhost:5173", authorization: `Bearer ${token}` }
    });
    assert.equal(allowedDevelopmentOrigin.statusCode, 200);

    const unsafeProjectUrl = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "不安全链接", repositoryUrl: "javascript:alert(1)" }
    });
    assert.equal(unsafeProjectUrl.statusCode, 400);

    const challenge = "local-desktop-check-1234";
    const health = await app.inject({
      method: "GET",
      url: `/api/health?challenge=${challenge}`,
      headers: { host: "[::1]:4318" }
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().proof, gatewayHealthProof(token, challenge));
    await app.close();
  });

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
      apiToken: false,
      disableSchedulers: true,
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
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
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
      apiToken: false,
      disableSchedulers: true,
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
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
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
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
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
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
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

  it("includes manually added VPS in bulk metrics and project inventory", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-bulk-manual-"));
    temporaryDirectories.push(directory);
    const credentialsDirectory = join(directory, "credentials");
    const knownHostsPath = join(directory, "known_hosts");
    const fakeSshPath = join(directory, "fake-ssh.sh");
    mkdirSync(credentialsDirectory);
    writeFileSync(join(credentialsDirectory, "test-key"), "test");
    writeFileSync(knownHostsPath, "[203.0.113.91]:22 ssh-ed25519 test\n");
    writeFileSync(
      fakeSshPath,
      `#!/bin/sh
case "$*" in
  *cpu_sample*) printf 'cpu_percent=12.5\nmemory_percent=34.5\ndisk_percent=45\nload1=0.42\n' ;;
  *) printf '%s\n' '__AI_VPS_GATEWAY_INVENTORY_V2__' 'META\thostname\tmanual-node' 'META\tos\tUbuntu 24.04' 'PROJECT\tnode\t/srv/manual/package.json' 'SERVICE\tprocess\tpm2:manual\tmanual\tonline\t127.0.0.1:3000\t/srv/manual\tmanual\t/srv/manual\t' ;;
esac
`
    );
    chmodSync(fakeSshPath, 0o755);

    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "手动批量节点",
      address: "203.0.113.91",
      sshPort: 22,
      sshUser: "ubuntu",
      credentialRef: "test-key"
    });
    const app = await buildApp(database, {
      apiToken: false,
      disableSchedulers: true,
      operationOptions: {
        sshExecutor: new SshExecutor({
          credentialStore: new CredentialStore(credentialsDirectory, knownHostsPath),
          sshBinary: fakeSshPath,
          timeoutMs: 5_000
        }),
        idleTimeoutMs: 60_000,
        maxSessionDurationMs: 600_000
      }
    });
    await app.ready();

    const metricsResponse = await app.inject({ method: "POST", url: "/api/metrics/all", payload: {} });
    assert.equal(metricsResponse.statusCode, 200);
    assert.deepEqual(metricsResponse.json().results.map((item: { serverId: string }) => item.serverId), [server.id]);
    assert.equal(metricsResponse.json().results[0].metric.source, "ssh");

    const inventoryResponse = await app.inject({ method: "POST", url: "/api/inventory/all-vps/sync-projects", payload: {} });
    assert.equal(inventoryResponse.statusCode, 200);
    assert.deepEqual(inventoryResponse.json().summary, { total: 1, success: 1, failed: 0, created: 1, updated: 0, archived: 0 });
    assert.equal(database.listProjects().length, 1);
    const project = database.getProject(database.listProjects()[0]!.id);
    assert.equal(project?.serverCount, 1);
    assert.equal(project?.servers[0]?.serverId, server.id);
    await app.close();
  });

  it("records an optional WebUI emergency-root rescue marker for root SSH assets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-api-root-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const app = await buildApp(database, { apiToken: false, disableSchedulers: true });
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
