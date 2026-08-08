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
});
