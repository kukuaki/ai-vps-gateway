import { randomBytes } from "node:crypto";
import { gatewayApiToken, gatewayHealthProof, secureTokenEqual } from "../server/auth.js";

export const API_PORT = 4318;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

interface GatewayHealthPayload {
  ok?: unknown;
  mode?: unknown;
  proof?: unknown;
}

interface IpcSenderSource {
  senderFrame: { url: string } | null;
  sender: { getURL(): string };
}

export type NavigationTarget =
  | { action: "internal" | "external"; url: string }
  | { action: "deny" };

export function resolveNavigationTarget(url: string): NavigationTarget {
  try {
    const parsed = new URL(url);
    if (parsed.origin === API_ORIGIN) return { action: "internal", url: parsed.href };
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { action: "external", url: parsed.href };
    }
  } catch {
    // Malformed URLs are denied below.
  }
  return { action: "deny" };
}

export function isTrustedIpcSender(event: IpcSenderSource): boolean {
  try {
    const frameUrl = event.senderFrame?.url;
    if (!frameUrl || new URL(frameUrl).origin !== API_ORIGIN) return false;
    return new URL(event.sender.getURL()).origin === API_ORIGIN;
  } catch {
    return false;
  }
}

export function isExpectedGatewayHealth(payload: unknown, expectedProof: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const health = payload as GatewayHealthPayload;
  return health.ok === true
    && health.mode === "local-only"
    && typeof health.proof === "string"
    && secureTokenEqual(health.proof, expectedProof);
}

export function initialGatewayPageLoadOptions(token: string): { extraHeaders: string } {
  return { extraHeaders: `x-ai-vps-gateway-token: ${token}` };
}

export async function gatewayAlreadyRunning(token = gatewayApiToken()): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  timeout.unref();
  try {
    const challenge = randomBytes(24).toString("base64url");
    const expectedProof = gatewayHealthProof(token, challenge);
    const response = await fetch(`${API_ORIGIN}/api/health?challenge=${encodeURIComponent(challenge)}`, {
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isExpectedGatewayHealth(payload, expectedProof)) return false;
    const webResponse = await fetch(`${API_ORIGIN}/`, { signal: controller.signal });
    return webResponse.ok && (webResponse.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
