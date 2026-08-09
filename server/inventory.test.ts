import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayDatabase } from "./db.js";
import { discoveredProjectsForInventory, parseInventoryOutput } from "./inventory.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("remote project inventory", () => {
  it("parses only safe service metadata and synchronizes deterministic project records", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "盘点测试节点", address: "203.0.113.70", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V1__",
      "META\thostname\tapp-01",
      "META\tos\tUbuntu 24.04",
      "META\tkernel\tLinux 6.8",
      "META\tdocker\tavailable",
      "PROJECT\tdocker\t/srv/demo/compose.yml",
      "PROJECT\tnode\t/srv/demo/client/package.json",
      "SERVICE\tdocker\tdemo-web\tghcr.io/example/web:latest\tUp 2 hours\t0.0.0.0:443->3000/tcp\t/srv/demo",
      "PORT\t0.0.0.0:443",
      ""
    ].join("\n"));

    assert.equal(inventory.projects.length, 2);
    assert.equal(inventory.services.length, 1);
    assert.equal(inventory.services[0]?.ports, "0.0.0.0:443->3000/tcp");
    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.services?.[0]?.critical, true);

    const first = database.syncDiscoveredProject(discovered[0]!);
    assert.equal(first.action, "created");
    assert.equal(first.project.source, "remote-inventory");
    assert.equal(first.project.services.length, 1);
    const second = database.syncDiscoveredProject(discovered[0]!);
    assert.equal(second.action, "unchanged");
    const stale = database.syncDiscoveredProject({
      ...discovered[0]!,
      sourceKey: server.id + ":stale",
      name: "过期自动项目"
    });
    assert.equal(stale.action, "created");
    assert.equal(database.archiveMissingDiscoveredProjects(server.id, [discovered[0]!.sourceKey]), 1);
    database.close();
  });
});
