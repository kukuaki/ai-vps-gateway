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

function slowFakeSsh(directory: string): string {
  const binary = join(directory, "slow-fake-ssh.sh");
  writeFileSync(binary, "#!/bin/sh\nsleep 0.2\nprintf 'command-ok\\n'\n");
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
    assert.equal(first.session.status, "active");
    assert.equal(second.session.status, "queued");

    const result = await operations.runCommand(first.session.id, first.capabilityToken, "printf ok");
    assert.equal(result.outcome, "completed");
    assert.match(result.stdout, /command-ok/);
    assert.doesNotMatch(result.stdout, /hunter2|secret/);

    const metric = await operations.collectMetrics(server.id, first.session.id, first.capabilityToken);
    assert.equal(metric.source, "ssh");
    assert.equal(metric.cpuPercent, 12.5);
    assert.equal(metric.memoryPercent, 34.5);
    assert.equal(metric.diskPercent, 45);
    assert.equal(metric.load1, 0.42);

    const blocked = await operations.runCommand(first.session.id, first.capabilityToken, "rm -rf / --no-preserve-root");
    assert.equal(blocked.outcome, "blocked");
    assert.equal(blocked.exitCode, null);
    const closed = operations.closeSession(first.session.id, first.capabilityToken);
    assert.equal(closed.promoted?.id, second.session.id);
    database.close();
  });

  it("requires the session capability and serializes remote operations until completion", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-operation-lock-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    const knownHosts = join(directory, "known_hosts");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    writeFileSync(knownHosts, "[203.0.113.55]:22 ssh-ed25519 test\n");
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "并发测试节点",
      address: "203.0.113.55",
      sshPort: 22,
      sshUser: "ubuntu",
      credentialRef: "test-key"
    });
    const operations = new GatewayOperations(database, {
      sshExecutor: new SshExecutor({
        credentialStore: new CredentialStore(credentials, knownHosts),
        sshBinary: slowFakeSsh(directory),
        timeoutMs: 5_000
      }),
      idleTimeoutMs: 60_000,
      maxSessionDurationMs: 600_000
    });
    const first = operations.openSession(server.id, "codex");
    const second = operations.openSession(server.id, "claude");

    await assert.rejects(
      operations.runCommand(first.session.id, second.capabilityToken, "printf unauthorized"),
      (error: unknown) => error instanceof GatewayOperationError && error.code === "InvalidSessionCapability"
    );

    const running = operations.runCommand(first.session.id, first.capabilityToken, "printf first");
    await assert.rejects(
      operations.runCommand(first.session.id, first.capabilityToken, "printf second"),
      (error: unknown) => error instanceof GatewayOperationError && error.code === "SessionOperationInFlight"
    );
    assert.throws(
      () => operations.closeSession(first.session.id, first.capabilityToken),
      (error: unknown) => error instanceof GatewayOperationError && error.code === "SessionOperationInFlight"
    );
    assert.equal(database.getSession(second.session.id, 60_000)?.status, "queued");

    assert.equal((await running).outcome, "completed");
    const closed = operations.closeSession(first.session.id, first.capabilityToken);
    assert.equal(closed.promoted?.id, second.session.id);
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

  it("allows a registered root SSH asset without a rescue marker", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-root-operations-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    const key = join(credentials, "root-key");
    const knownHosts = join(directory, "known_hosts");
    mkdirSync(credentials);
    writeFileSync(key, "test");
    writeFileSync(knownHosts, "[203.0.113.54]:22 ssh-ed25519 test\n");
    const store = new CredentialStore(credentials, knownHosts);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "root 直连节点",
      address: "203.0.113.54",
      sshPort: 22,
      sshUser: "root",
      credentialRef: "root-key"
    });
    const operations = new GatewayOperations(database, {
      sshExecutor: new SshExecutor({ credentialStore: store, sshBinary: fakeSsh(directory), timeoutMs: 5_000 }),
      idleTimeoutMs: 60_000,
      maxSessionDurationMs: 600_000
    });

    const session = operations.openSession(server.id, "codex");
    assert.equal(session.session.status, "active");
    assert.equal(database.emergencyRootActive(server.id), false);
    const command = await operations.runCommand(session.session.id, session.capabilityToken, "printf ok");
    assert.equal(command.outcome, "completed");
    const metric = await operations.collectMetrics(server.id, session.session.id, session.capabilityToken);
    assert.equal(metric.source, "ssh");

    database.grantEmergencyRoot(server.id, 60_000);
    operations.revokeEmergencyRoot(server.id);
    assert.equal(database.getSession(session.session.id, 60_000)?.status, "active");
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

  it("records one alert when a metric crosses a threshold and deduplicates repeats", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-metric-alert-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    const knownHosts = join(directory, "known_hosts");
    writeFileSync(knownHosts, "[203.0.113.53]:22 ssh-ed25519 test\n");
    const fakeBinary = join(directory, "high-metrics-ssh.sh");
    writeFileSync(
      fakeBinary,
      `#!/bin/sh
printf '%s' 'cpu_percent=95
memory_percent=91
disk_percent=86
load1=2.4
'
`
    );
    chmodSync(fakeBinary, 0o755);
    const store = new CredentialStore(credentials, knownHosts);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "告警测试节点", address: "203.0.113.53", sshPort: 22, sshUser: "ubuntu", credentialRef: "test-key" });
    const operations = new GatewayOperations(database, { sshExecutor: new SshExecutor({ credentialStore: store, sshBinary: fakeBinary }), idleTimeoutMs: 60_000, maxSessionDurationMs: 600_000 });

    await operations.collectMetrics(server.id);
    await operations.collectMetrics(server.id);
    assert.equal(database.recentMetricAlerts().length, 1);
    assert.match(database.recentMetricAlerts()[0]?.summary ?? "", /CPU 高/);
    database.close();
  });

  it("binds direct SSH assets to the physical interface without proxy hops", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-direct-ssh-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    const knownHosts = join(directory, "known_hosts");
    writeFileSync(knownHosts, "[203.0.113.54]:22 ssh-ed25519 test\n");
    const fakeBinary = join(directory, "capture-ssh.sh");
    writeFileSync(fakeBinary, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
    chmodSync(fakeBinary, 0o755);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "直连测试节点", address: "203.0.113.54", sshPort: 22, sshUser: "ubuntu", networkMode: "direct", credentialRef: "test-key" });
    const executor = new SshExecutor({ credentialStore: new CredentialStore(credentials, knownHosts), sshBinary: fakeBinary, directInterface: "en0" });

    const result = await executor.execute(server, "true");
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /BindInterface=en0/);
    assert.match(result.stdout, /ProxyCommand=none/);
    assert.match(result.stdout, /ProxyJump=none/);
    database.close();
  });

  it("does not inherit proxy environment variables into SSH", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-no-proxy-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    const knownHosts = join(directory, "known_hosts");
    writeFileSync(knownHosts, "[203.0.113.55]:22 ssh-ed25519 test\n");
    const fakeBinary = join(directory, "capture-ssh-environment.sh");
    writeFileSync(
      fakeBinary,
      "#!/bin/sh\nprintf 'http_proxy=%s\\n' \"${HTTP_PROXY-}\"\nprintf 'https_proxy=%s\\n' \"${HTTPS_PROXY-}\"\nprintf 'all_proxy=%s\\n' \"${ALL_PROXY-}\"\n"
    );
    chmodSync(fakeBinary, 0o755);
    const previousEnvironment = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY
    };
    process.env.HTTP_PROXY = "http://gateway-test-proxy.invalid:8080";
    process.env.HTTPS_PROXY = "http://gateway-test-proxy.invalid:8080";
    process.env.ALL_PROXY = "socks5://gateway-test-proxy.invalid:1080";

    try {
      const database = new GatewayDatabase(directory);
      const server = database.createServer({ name: "无代理测试节点", address: "203.0.113.55", sshPort: 22, sshUser: "ubuntu", credentialRef: "test-key" });
      const executor = new SshExecutor({ credentialStore: new CredentialStore(credentials, knownHosts), sshBinary: fakeBinary });
      const result = await executor.execute(server, "true");
      assert.equal(result.exitCode, 0);
      assert.doesNotMatch(result.stdout, /gateway-test-proxy/);
      assert.match(result.stdout, /http_proxy=\nhttps_proxy=\nall_proxy=\n/);
      database.close();
    } finally {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
