import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerRecord } from "./types.js";

export class CredentialError extends Error {
  readonly code = "CredentialUnavailable";

  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

export function defaultCredentialDirectory(): string {
  if (process.env.ALLVPS_CREDENTIAL_DIR) return process.env.ALLVPS_CREDENTIAL_DIR;
  return process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "AI VPS Gateway", "credentials")
    : join(homedir(), ".local", "share", "ai-vps-gateway", "credentials");
}

export function defaultKnownHostsPath(): string {
  return process.env.ALLVPS_KNOWN_HOSTS_FILE ?? join(homedir(), ".ssh", "known_hosts");
}

function validReference(reference: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(reference) && reference !== "." && reference !== "..";
}

export class CredentialStore {
  readonly directory: string;
  readonly knownHostsPath: string;

  constructor(directory = defaultCredentialDirectory(), knownHostsPath = defaultKnownHostsPath()) {
    this.directory = directory;
    this.knownHostsPath = knownHostsPath;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }

  pathFor(server: ServerRecord): string {
    const reference = server.credentialRef;
    if (!reference) {
      throw new CredentialError(`VPS“${server.name}”尚未配置网关凭据引用`);
    }
    if (!validReference(reference)) {
      throw new CredentialError(`VPS“${server.name}”的凭据引用格式无效`);
    }

    const path = join(this.directory, reference);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      throw new CredentialError(`VPS“${server.name}”的网关凭据引用不可用`);
    }
    if (!stat.isFile()) {
      throw new CredentialError(`VPS“${server.name}”的网关凭据不是普通文件`);
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new CredentialError(`VPS“${server.name}”的网关凭据文件权限过宽，请收紧到仅当前用户可写`);
    }
    return path;
  }

  hasKnownHosts(): boolean {
    return existsSync(this.knownHostsPath);
  }
}
