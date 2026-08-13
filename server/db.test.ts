import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("GatewayDatabase", () => {
  it("stores, updates and archives a manually added server", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-db-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);

    const created = database.createServer({
      name: "测试节点",
      address: "203.0.113.10",
      sshPort: 47680,
      sshUser: "ubuntu",
      role: "代理节点",
      environment: "production",
      tags: ["docker", "test"],
      healthChecks: [{ name: "Public HTTP", kind: "http", config: { url: "https://example.com/health", expectedStatusCodes: [200] } }]
    });

    assert.equal(created.sshPort, 47680);
    assert.deepEqual(created.tags, ["docker", "test"]);
    assert.equal(created.healthChecks.length, 1);
    assert.equal(database.listServers().length, 1);

    const updated = database.updateServer(created.id, { maintenance: true, role: "维护中的代理节点" });
    assert.equal(updated?.maintenance, true);
    assert.equal(updated?.role, "维护中的代理节点");

    database.audit("server.test", "server", created.id, "测试审计事件");
    assert.equal(database.recentAudit(10)[0]?.summary, "测试审计事件");
    assert.equal(database.archiveServer(created.id), true);
    assert.equal(database.listServers().length, 0);
    assert.equal(database.getServer(created.id), null);
    database.close();
  });

  it("returns metric history in chronological order with a bounded limit", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-db-metrics-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "指标节点", address: "203.0.113.20", sshPort: 22, sshUser: "ubuntu" });
    database.saveMetric({
      serverId: server.id,
      collectedAt: "2026-08-09T00:00:00.000Z",
      cpuPercent: 10,
      memoryPercent: 20,
      diskPercent: 30,
      load1: 0.1,
      source: "ssh",
      note: null
    });
    database.saveMetric({
      serverId: server.id,
      collectedAt: "2026-08-09T00:01:00.000Z",
      cpuPercent: 40,
      memoryPercent: 50,
      diskPercent: 60,
      load1: 0.4,
      source: "ssh",
      note: null
    });

    const history = database.metricHistory(server.id, 1);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.cpuPercent, 40);
    assert.equal(database.metricHistory(server.id, 10)[0]?.collectedAt, "2026-08-09T00:00:00.000Z");
    database.close();
  });

  it("redacts credential-bearing audit metadata before persistence", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-db-audit-redaction-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);

    const event = database.audit("test.sensitive", "server", null, "脱敏测试", "warning", {
      credentialRef: "gateway-generated-secret.ed25519",
      nested: { token: "secret-value", note: "保留" }
    });

    assert.equal("credentialRef" in event.metadata, false);
    assert.deepEqual(event.metadata.nested, { note: "保留" });
    assert.doesNotMatch(JSON.stringify(database.recentAudit()[0]?.metadata), /secret-value|gateway-generated/);
    database.close();
  });
});
