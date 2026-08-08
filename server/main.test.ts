import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./main.js";
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
        healthChecks: []
      }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as { server: { id: string } };

    const listResponse = await app.inject({ method: "GET", url: "/api/servers" });
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.json().servers.length, 1);

    const archiveResponse = await app.inject({ method: "POST", url: `/api/servers/${created.server.id}/archive` });
    assert.equal(archiveResponse.statusCode, 200);
    assert.equal(archiveResponse.json().archived, true);

    await app.close();
  });
});
