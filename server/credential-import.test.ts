import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { importAllVpsCredentials } from "./credential-import.js";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("all-vps credential import", () => {
  it("copies only an address-matched key and stores its logical reference", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-credential-import-"));
    temporaryDirectories.push(directory);
    const sourceDirectory = join(directory, "all-vps");
    const credentialDirectory = join(directory, "credentials");
    mkdirSync(sourceDirectory);
    const sourceFile = join(sourceDirectory, "edge-203.0.113.80.key");
    writeFileSync(sourceFile, "TEST_KEY_BYTES");
    chmodSync(sourceFile, 0o600);
    writeFileSync(join(sourceDirectory, "unrelated.key"), "OTHER_KEY_BYTES");

    const database = new GatewayDatabase(join(directory, "data"));
    const server = database.syncImportedServer({
      source: "all-vps",
      sourceKey: "all-vps:203.0.113.80:22",
      input: { name: "凭据导入节点", address: "203.0.113.80", sshPort: 22, sshUser: "root" }
    }).server;

    const preview = importAllVpsCredentials(database, { sourceDirectory, credentialDirectory, dryRun: true });
    assert.deepEqual(preview.summary, { ready: 1, imported: 0, unchanged: 0, missing: 0, skipped: 0 });
    assert.equal(database.getServer(server.id)?.credentialRef, null);

    const result = importAllVpsCredentials(database, { sourceDirectory, credentialDirectory });
    assert.deepEqual(result.summary, { ready: 0, imported: 1, unchanged: 0, missing: 0, skipped: 0 });
    assert.equal(database.getServer(server.id)?.credentialRef, "edge-203.0.113.80.key");
    const destination = join(credentialDirectory, "edge-203.0.113.80.key");
    assert.equal(existsSync(destination), true);
    assert.equal(statSync(destination).mode & 0o777, 0o600);

    const repeated = importAllVpsCredentials(database, { sourceDirectory, credentialDirectory });
    assert.deepEqual(repeated.summary, { ready: 0, imported: 0, unchanged: 1, missing: 0, skipped: 0 });
    database.close();
  });
});
