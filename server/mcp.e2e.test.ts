import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GatewayDatabase } from "./db.js";
import { buildApp } from "./main.js";
import { CredentialStore } from "./credentials.js";
import { SshExecutor } from "./ssh.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function textPayload(result: unknown): Record<string, unknown> {
  assert.ok(result && typeof result === "object" && "content" in result);
  const content = result.content;
  assert.ok(Array.isArray(content));
  const block = content.find((item): item is { type: "text"; text: string } =>
    Boolean(item && typeof item === "object" && item.type === "text" && typeof item.text === "string")
  );
  assert.ok(block);
  const parsed: unknown = JSON.parse(block.text);
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  return parsed as Record<string, unknown>;
}

describe("MCP stdio gateway", () => {
  it("runs the core session workflow through an authenticated local API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-mcp-e2e-"));
    temporaryDirectories.push(directory);
    const credentials = join(directory, "credentials");
    const knownHosts = join(directory, "known_hosts");
    const fakeSsh = join(directory, "fake-ssh.sh");
    mkdirSync(credentials);
    writeFileSync(join(credentials, "test-key"), "test");
    writeFileSync(knownHosts, "[203.0.113.88]:22 ssh-ed25519 test\n");
    writeFileSync(fakeSsh, "#!/bin/sh\nprintf 'mcp-command-ok token=should-redact\\n'\n");
    chmodSync(fakeSsh, 0o755);

    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "MCP E2E 节点",
      address: "203.0.113.88",
      sshPort: 22,
      sshUser: "ubuntu",
      credentialRef: "test-key"
    });
    const apiToken = "m".repeat(43);
    const app = await buildApp(database, {
      apiToken,
      disableSchedulers: true,
      operationOptions: {
        sshExecutor: new SshExecutor({
          credentialStore: new CredentialStore(credentials, knownHosts),
          sshBinary: fakeSsh,
          timeoutMs: 5_000
        }),
        idleTimeoutMs: 60_000,
        maxSessionDurationMs: 600_000
      }
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("mcp/index.ts")],
      cwd: resolve("."),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ALLVPS_API_URL: `http://127.0.0.1:${address.port}`,
        ALLVPS_API_TOKEN: apiToken,
        ALLVPS_DATA_DIR: directory
      },
      stderr: "pipe"
    });
    const client = new Client({ name: "ai-vps-gateway-e2e", version: "0.1.1" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.ok(["list_servers", "open_session", "run_command", "close_session"].every((name) => tools.tools.some((tool) => tool.name === name)));

      const listed = textPayload(await client.callTool({ name: "list_servers", arguments: {} }));
      const listedServer = (listed.servers as Array<Record<string, unknown>>)[0];
      assert.equal(listedServer?.id, server.id);
      assert.equal("credentialRef" in (listedServer ?? {}), false);

      const opened = textPayload(await client.callTool({
        name: "open_session",
        arguments: { serverId: server.id, requester: "mcp-e2e" }
      }));
      const session = opened.session as { id: string; status: string };
      assert.equal(session.status, "active");

      const executed = textPayload(await client.callTool({
        name: "run_command",
        arguments: { sessionId: session.id, command: "printf mcp-command-ok" }
      }));
      const result = executed.result as { outcome: string; stdout: string };
      assert.equal(result.outcome, "completed");
      assert.match(result.stdout, /mcp-command-ok/);
      assert.doesNotMatch(result.stdout, /should-redact/);

      const closed = textPayload(await client.callTool({
        name: "close_session",
        arguments: { sessionId: session.id, reason: "mcp_e2e_complete" }
      }));
      assert.equal((closed.session as { status: string }).status, "closed");
      assert.equal(database.listActiveSessions(60_000).length, 0);
    } finally {
      await client.close().catch(() => undefined);
      await app.close();
    }
  });
});
