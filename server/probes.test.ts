import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { probeHttp, probeSshBanner, probeTcp } from "./probes.js";

const servers: TcpServer[] = [];
const httpServers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all(
    [...servers.splice(0), ...httpServers.splice(0)].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function listen(handler: (socket: import("node:net").Socket) => void): Promise<number> {
  const server = createTcpServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function listenHttp(
  handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void
): Promise<number> {
  const server = createHttpServer(handler);
  httpServers.push(server);
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

  it("follows an HTTP redirect before evaluating the expected status code", async () => {
    const port = await listenHttp((request, response) => {
      if (request.url === "/") {
        response.writeHead(308, { location: "/health" });
        response.end();
        return;
      }
      response.writeHead(200);
      response.end("ok");
    });
    const result = await probeHttp({
      id: "test-check",
      serverId: "test-server",
      name: "Redirecting health endpoint",
      kind: "http",
      enabled: true,
      config: { url: `http://127.0.0.1:${port}/`, expectedStatusCodes: [200] }
    });
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
  });
});
