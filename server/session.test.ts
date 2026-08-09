import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("session leases", () => {
  it("serializes sessions per server and promotes the oldest queued session", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-session-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "租约节点", address: "203.0.113.40", sshPort: 22, sshUser: "root" });

    const first = database.openSession(server.id, "codex", 60_000, 600_000);
    const second = database.openSession(server.id, "claude", 60_000, 600_000);
    assert.equal(first?.status, "active");
    assert.equal(second?.status, "queued");
    assert.equal(second?.queuePosition, 1);
    assert.equal(database.listActiveSessions(60_000).length, 2);

    const closed = database.closeSession(first?.id ?? "", 60_000, "test");
    assert.equal(closed?.session.status, "closed");
    assert.equal(closed?.promoted?.id, second?.id);
    assert.equal(database.getSession(second?.id ?? "", 60_000)?.status, "active");
    database.close();
  });

  it("expires an idle active lease and promotes a queued session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-session-expire-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "过期节点", address: "203.0.113.41", sshPort: 22, sshUser: "root" });
    const first = database.openSession(server.id, "codex", 50, 600_000);
    const second = database.openSession(server.id, "claude", 60_000, 600_000);
    assert.equal(first?.status, "active");
    assert.equal(second?.status, "queued");

    await new Promise((resolve) => setTimeout(resolve, 100));
    database.reconcileSessions(60_000);
    assert.equal(database.getSession(first?.id ?? "", 60_000)?.status, "expired");
    assert.equal(database.getSession(second?.id ?? "", 60_000)?.status, "active");
    database.close();
  });
});
