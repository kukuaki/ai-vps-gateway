import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeSshBanner, probeTcp } from "./probes.js";

const servers: TcpServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(handler: (socket: import("node:net").Socket) => void): Promise<number> {
  const server = createTcpServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

describe("network probes", () => {
  it("recognizes an SSH banner without using a private key", async () => {
    const port = await listen((socket) => socket.end("SSH-2.0-TestGateway\r\n"));
    const result = await probeSshBanner("127.0.0.1", port);
    assert.equal(result.ok, true);
    assert.match(result.detail, /^SSH-2\.0-TestGateway/);
  });

  it("reports a reachable TCP service independently from ICMP", async () => {
    const port = await listen(() => undefined);
    const result = await probeTcp("127.0.0.1", port);
    assert.equal(result.ok, true);
    assert.equal(result.kind, "tcp");
  });

  it("returns a useful failure for a closed port", async () => {
    const result = await probeTcp("127.0.0.1", 1, 300);
    assert.equal(result.ok, false);
    assert.match(result.detail, /拒绝|超时|refused|timed out/i);
  });
});
