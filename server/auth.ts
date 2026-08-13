import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const GATEWAY_AUTH_COOKIE = "ai_vps_gateway";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function defaultDataDirectory(): string {
  if (process.env.ALLVPS_DATA_DIR) return process.env.ALLVPS_DATA_DIR;
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "AI VPS Gateway")
    : join(homedir(), ".local", "share", "ai-vps-gateway");
}

export function defaultGatewayTokenPath(dataDirectory = defaultDataDirectory()): string {
  return process.env.ALLVPS_API_TOKEN_FILE ?? join(dataDirectory, "gateway.token");
}

function readToken(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("网关 API 令牌不是普通文件");
  chmodSync(path, 0o600);
  const token = readFileSync(path, "utf8").trim();
  if (!TOKEN_PATTERN.test(token)) throw new Error("网关 API 令牌格式无效");
  return token;
}

export function gatewayApiToken(dataDirectory = defaultDataDirectory()): string {
  const environmentToken = process.env.ALLVPS_API_TOKEN?.trim();
  if (environmentToken) {
    if (!TOKEN_PATTERN.test(environmentToken)) throw new Error("ALLVPS_API_TOKEN 格式无效");
    return environmentToken;
  }

  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  chmodSync(dataDirectory, 0o700);
  const path = defaultGatewayTokenPath(dataDirectory);
  if (existsSync(path)) return readToken(path);
  const token = randomBytes(32).toString("base64url");
  try {
    writeFileSync(path, token + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  return readToken(path);
}

export function secureTokenEqual(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function gatewayHealthProof(token: string, challenge: string): string {
  return createHmac("sha256", token).update(challenge).digest("base64url");
}

export function localGatewayBaseUrl(value = process.env.ALLVPS_API_URL ?? "http://127.0.0.1:4318"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ALLVPS_API_URL 不是有效 URL");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("ALLVPS_API_URL 必须是无凭据、无路径的本机 HTTP 地址");
  }
  return url.origin;
}

export async function verifyGatewayIdentity(
  baseUrl: string,
  token: string,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  const challenge = randomBytes(24).toString("base64url");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  timeout.unref();
  try {
    const response = await fetchImplementation(`${localGatewayBaseUrl(baseUrl)}/api/health?challenge=${challenge}`, {
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; mode?: string; proof?: string | null } | null;
    if (
      !response.ok ||
      payload?.ok !== true ||
      payload.mode !== "local-only" ||
      !secureTokenEqual(payload.proof ?? undefined, gatewayHealthProof(token, challenge))
    ) {
      throw new Error("本机端口上的服务无法证明其为当前 AI VPS Gateway");
    }
  } finally {
    clearTimeout(timeout);
  }
}
