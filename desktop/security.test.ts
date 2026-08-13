import assert from "node:assert/strict";
import { test } from "node:test";
import {
  API_ORIGIN,
  gatewayAlreadyRunning,
  initialGatewayPageLoadOptions,
  isExpectedGatewayHealth,
  isTrustedIpcSender,
  resolveNavigationTarget
} from "./security.js";
import { gatewayHealthProof } from "../server/auth.js";

test("running gateway verification uses a fresh authenticated challenge", async (context) => {
  const token = "t".repeat(43);
  const challenges: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/health") {
      const challenge = url.searchParams.get("challenge") ?? "";
      challenges.push(challenge);
      return Response.json({
        ok: true,
        mode: "local-only",
        proof: gatewayHealthProof(token, challenge)
      });
    }
    return new Response("<!doctype html>", {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  });

  assert.equal(await gatewayAlreadyRunning(token), true);
  assert.equal(await gatewayAlreadyRunning(token), true);
  assert.match(challenges[0] ?? "", /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(challenges[0], challenges[1]);
});

test("running gateway verification rejects a forged health proof", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    ok: true,
    mode: "local-only",
    proof: "f".repeat(43)
  }));

  assert.equal(await gatewayAlreadyRunning("t".repeat(43)), false);
});

test("only the initial gateway page load receives the API token header", () => {
  const token = "t".repeat(43);
  assert.deepEqual(initialGatewayPageLoadOptions(token), {
    extraHeaders: `x-ai-vps-gateway-token: ${token}`
  });
});

test("gateway health requires the expected challenge proof", () => {
  const proof = "p".repeat(43);
  assert.equal(isExpectedGatewayHealth({ ok: true, mode: "local-only", proof }, proof), true);
  assert.equal(isExpectedGatewayHealth({ ok: true, mode: "local-only", proof: "x".repeat(43) }, proof), false);
  assert.equal(isExpectedGatewayHealth({ ok: true, mode: "local-only" }, proof), false);
  assert.equal(isExpectedGatewayHealth("<html>AI VPS Gateway</html>", proof), false);
});

test("navigation compares exact origins and only delegates HTTP URLs", () => {
  assert.deepEqual(resolveNavigationTarget(`${API_ORIGIN}/projects?id=1`), {
    action: "internal",
    url: `${API_ORIGIN}/projects?id=1`
  });
  assert.equal(resolveNavigationTarget("http://127.0.0.1:43180/projects").action, "external");
  assert.equal(resolveNavigationTarget("https://example.test/docs").action, "external");
  assert.deepEqual(resolveNavigationTarget("javascript:alert(1)"), { action: "deny" });
  assert.deepEqual(resolveNavigationTarget("file:///tmp/gateway.html"), { action: "deny" });
  assert.deepEqual(resolveNavigationTarget("not a url"), { action: "deny" });
});

test("IPC requires both frame and WebContents URLs to have the API origin", () => {
  const trustedUrl = `${API_ORIGIN}/#/settings`;
  assert.equal(isTrustedIpcSender({
    senderFrame: { url: trustedUrl },
    sender: { getURL: () => trustedUrl }
  }), true);
  assert.equal(isTrustedIpcSender({
    senderFrame: { url: "http://127.0.0.1:43180/" },
    sender: { getURL: () => trustedUrl }
  }), false);
  assert.equal(isTrustedIpcSender({
    senderFrame: { url: trustedUrl },
    sender: { getURL: () => "https://attacker.example/" }
  }), false);
  assert.equal(isTrustedIpcSender({
    senderFrame: null,
    sender: { getURL: () => trustedUrl }
  }), false);
});
