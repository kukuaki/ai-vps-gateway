import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CredentialStore } from "./credentials.js";
import { GatewayDatabase } from "./db.js";
import { GatewayOperationError, GatewayOperations } from "./operations.js";
import { SshExecutor } from "./ssh.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeSsh(directory: string): string {
  const binary = join(directory, "fake-ssh.sh");
  writeFileSync(
    binary,
    `#!/bin/sh
case "$*" in
  *cpu_percent*) printf 'cpu_percent=12.5\\nmemory_percent=34.5\\ndisk_percent=45\\nload1=0.42\\n' ;;
  *) printf 'command-ok token=secret password=hunter2\\n' ;;
esac
`
  );
  chmodSync(binary, 0o755);
  return binary;
}

describe("gateway operations", () => {
  it("executes through a fake SSH process, redacts output and serializes sessions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-operations-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    const key = join(credentials, "test-key");
    const knownHosts = join(directory, "known_hosts");
    mkdirSync(credentials);
    writeFileSync(key, "PRIVATE_KEY_SHOULD_NOT_BE_READ_BY_NODE");
    writeFileSync(knownHosts, "[203.0.113.50]:22 ssh-ed25519 test\n");
    const store = new CredentialStore(credentials, knownHosts);
    const executor = new SshExecutor({ credentialStore: store, sshBinary: fakeSsh(directory), timeoutMs: 5_000 });
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "执行测试节点",
      address: "203.0.113.50",
      sshPort: 22,
      sshUser: "ubuntu",
      credentialRef: "test-key"
    });
    const operations = new GatewayOperations(database, { sshExecutor: executor, idleTimeoutMs: 60_000, maxSessionDurationMs: 600_000 });

    const first = operations.openSession(server.id, "codex");
    const second = operations.openSession(server.id, "claude");
    assert.equal(first.status, "active");
    assert.equal(second.status, "queued");

    const result = await operations.runCommand(first.id, "printf ok");
    assert.equal(result.outcome, "completed");
    assert.match(result.stdout, /command-ok/);
    assert.doesNotMatch(result.stdout, /hunter2|secret/);

    const metric = await operations.collectMetrics(server.id, first.id);
    assert.equal(metric.source, "ssh");
    assert.equal(metric.cpuPercent, 12.5);
    assert.equal(metric.memoryPercent, 34.5);
    assert.equal(metric.diskPercent, 45);
    assert.equal(metric.load1, 0.42);

    const blocked = await operations.runCommand(first.id, "rm -rf / --no-preserve-root");
    assert.equal(blocked.outcome, "blocked");
    assert.equal(blocked.exitCode, null);
    const closed = operations.closeSession(first.id);
    assert.equal(closed.promoted?.id, second.id);
    database.close();
  });

  it("parses one metric per line from the SSH response", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-metrics-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    const knownHosts = join(directory, "known_hosts");
    writeFileSync(knownHosts, "[203.0.113.52]:22 ssh-ed25519 test\n");
    const fakeBinary = join(directory, "metrics-ssh.sh");
    writeFileSync(
      fakeBinary,
      `#!/bin/sh
printf '%s' 'cpu_percent=12.5
memory_percent=34.5
disk_percent=45
load1=0.42
'
`
    );
    chmodSync(fakeBinary, 0o755);
    const store = new CredentialStore(credentials, knownHosts);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "指标格式测试节点",
      address: "203.0.113.52",
      sshPort: 22,
      sshUser: "ubuntu",
      credentialRef: "test-key"
    });
    const operations = new GatewayOperations(database, {
      sshExecutor: new SshExecutor({ credentialStore: store, sshBinary: fakeBinary }),
      idleTimeoutMs: 60_000,
      maxSessionDurationMs: 600_000
    });

    const metric = await operations.collectMetrics(server.id);
    assert.deepEqual(
      {
        cpuPercent: metric.cpuPercent,
        memoryPercent: metric.memoryPercent,
        diskPercent: metric.diskPercent,
        load1: metric.load1
      },
      { cpuPercent: 12.5, memoryPercent: 34.5, diskPercent: 45, load1: 0.42 }
    );
    database.close();
  });

  it("returns unavailable metrics and rejects sessions when no credential is configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-no-credential-"));
    temporaryDirectories.push(directory);
    const credentials = new CredentialStore(join(directory, "credentials"), join(directory, "known_hosts"));
    writeFileSync(credentials.knownHostsPath, "known-hosts\n");
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "未配置凭据节点", address: "203.0.113.51", sshPort: 22, sshUser: "ubuntu" });
    const operations = new GatewayOperations(database, {
      sshExecutor: new SshExecutor({ credentialStore: credentials, sshBinary: "/bin/false" }),
      idleTimeoutMs: 60_000,
      maxSessionDurationMs: 600_000
    });

    assert.throws(() => operations.openSession(server.id, "codex"), (error: unknown) => error instanceof GatewayOperationError && error.code === "CredentialUnavailable");
    const metric = await operations.collectMetrics(server.id);
    assert.equal(metric.source, "unavailable");
    assert.match(metric.note ?? "", /尚未配置/);
    database.close();
  });
});
