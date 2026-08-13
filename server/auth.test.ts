import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultGatewayTokenPath,
  gatewayApiToken,
  gatewayHealthProof,
  localGatewayBaseUrl,
  secureTokenEqual,
  verifyGatewayIdentity
} from "./auth.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("gateway authentication", () => {
  it("creates one stable gateway token outside the repository with private permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-auth-"));
    temporaryDirectories.push(directory);
    const dataDirectory = join(directory, "data");
    const token = gatewayApiToken(dataDirectory);

    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(gatewayApiToken(dataDirectory), token);
    assert.equal(lstatSync(dataDirectory).mode & 0o777, 0o700);
    assert.equal(lstatSync(defaultGatewayTokenPath(dataDirectory)).mode & 0o777, 0o600);
    assert.equal(secureTokenEqual(token, token), true);
    assert.equal(secureTokenEqual(`${token}x`, token), false);
    assert.notEqual(gatewayHealthProof(token, "challenge-value-123"), gatewayHealthProof(token, "challenge-value-456"));
  });

  it("rejects a symbolic-link token file", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-auth-symlink-"));
    temporaryDirectories.push(directory);
    const dataDirectory = join(directory, "data");
    const target = join(directory, "target-token");
    gatewayApiToken(dataDirectory);
    rmSync(defaultGatewayTokenPath(dataDirectory));
    writeFileSync(target, "a".repeat(43));
    symlinkSync(target, defaultGatewayTokenPath(dataDirectory));

    assert.throws(() => gatewayApiToken(dataDirectory), /不是普通文件/);
  });

  it("only sends gateway credentials after a local health proof succeeds", async () => {
    const token = "b".repeat(43);
    assert.equal(localGatewayBaseUrl("http://localhost:4318"), "http://localhost:4318");
    assert.throws(() => localGatewayBaseUrl("https://127.0.0.1:4318"), /本机 HTTP/);
    assert.throws(() => localGatewayBaseUrl("http://example.test:4318"), /本机 HTTP/);
    assert.throws(() => localGatewayBaseUrl("http://127.0.0.1:4318/api"), /本机 HTTP/);

    await verifyGatewayIdentity("http://127.0.0.1:4318", token, async (input) => {
      const challenge = new URL(String(input)).searchParams.get("challenge") ?? "";
      return new Response(JSON.stringify({ ok: true, mode: "local-only", proof: gatewayHealthProof(token, challenge) }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    await assert.rejects(
      verifyGatewayIdentity("http://127.0.0.1:4318", token, async () => new Response(JSON.stringify({ ok: true, mode: "local-only", proof: "forged" }), { status: 200 })),
      /无法证明/
    );
  });
});
