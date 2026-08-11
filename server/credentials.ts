import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerRecord } from "./types.js";

const execFileAsync = promisify(execFile);

const GENERATED_REFERENCE_PREFIX = "gateway-generated-";
const SERVER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export interface GeneratedCredential {
  credentialRef: string;
  publicKey: string;
}

function validReference(reference: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(reference) && reference !== "." && reference !== "..";
}

export function generatedCredentialReference(serverId: string): string {
  if (!SERVER_ID_PATTERN.test(serverId)) throw new CredentialError("VPS ID 格式无效，无法生成网关凭据");
  return `${GENERATED_REFERENCE_PREFIX}${serverId}.ed25519`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshBootstrapCommand(publicKey: string): string {
  const quotedKey = shellQuote(publicKey);
  return `umask 077; mkdir -p "$HOME/.ssh"; touch "$HOME/.ssh/authorized_keys"; grep -Fqx ${quotedKey} "$HOME/.ssh/authorized_keys" || printf '%s\\n' ${quotedKey} >> "$HOME/.ssh/authorized_keys"; chmod 700 "$HOME/.ssh"; chmod 600 "$HOME/.ssh/authorized_keys"`;
}

function ordinaryFile(path: string, description: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new CredentialError(`${description}不存在`);
  }
  if (!stat.isFile()) throw new CredentialError(`${description}不是普通文件`);
}

function publicKeyFrom(path: string): string {
  ordinaryFile(path, "网关公钥");
  const publicKey = readFileSync(path, "utf8").trim();
  if (!/^ssh-ed25519\s+\S+(?:\s+[^\r\n]*)?$/.test(publicKey)) {
    throw new CredentialError("生成的网关公钥格式无效");
  }
  return publicKey;
}

export class CredentialStore {
  readonly directory: string;
  readonly knownHostsPath: string;
  private readonly keygenBinary: string;

  constructor(
    directory = defaultCredentialDirectory(),
    knownHostsPath = defaultKnownHostsPath(),
    keygenBinary = process.env.ALLVPS_SSH_KEYGEN_BIN ?? "ssh-keygen"
  ) {
    this.directory = directory;
    this.knownHostsPath = knownHostsPath;
    this.keygenBinary = keygenBinary;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }

  private pathForReference(reference: string): string {
    if (!validReference(reference)) throw new CredentialError("网关凭据引用格式无效");
    return join(this.directory, reference);
  }

  pathFor(server: ServerRecord): string {
    const reference = server.credentialRef;
    if (!reference) {
      throw new CredentialError(`VPS“${server.name}”尚未配置网关凭据引用`);
    }
    if (!validReference(reference)) throw new CredentialError(`VPS“${server.name}”的凭据引用格式无效`);

    const path = this.pathForReference(reference);
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

  ensureKnownHosts(): void {
    mkdirSync(dirname(this.knownHostsPath), { recursive: true, mode: 0o700 });
    try {
      ordinaryFile(this.knownHostsPath, "SSH known_hosts");
    } catch (error) {
      if (!(error instanceof CredentialError) || !error.message.endsWith("不存在")) throw error;
      writeFileSync(this.knownHostsPath, "", { mode: 0o600 });
    }
    chmodSync(this.knownHostsPath, 0o600);
  }

  async ensureGeneratedCredential(serverId: string): Promise<GeneratedCredential> {
    const credentialRef = generatedCredentialReference(serverId);
    const privatePath = this.pathForReference(credentialRef);
    const publicPath = `${privatePath}.pub`;
    const privateExists = existsSync(privatePath);
    const publicExists = existsSync(publicPath);

    if (privateExists || publicExists) {
      if (!privateExists || !publicExists) {
        throw new CredentialError("网关自动生成的 SSH 凭据不完整，请删除残缺文件后重新绑定");
      }
      ordinaryFile(privatePath, "网关私钥");
      chmodSync(privatePath, 0o600);
      chmodSync(publicPath, 0o644);
      return { credentialRef, publicKey: publicKeyFrom(publicPath) };
    }

    const temporaryBase = join(this.directory, `.${credentialRef}.${randomUUID()}`);
    try {
      await execFileAsync(
        this.keygenBinary,
        ["-q", "-t", "ed25519", "-N", "", "-C", `ai-vps-gateway:${serverId}`, "-f", temporaryBase],
        {
          env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: homedir(), LANG: "C", LC_ALL: "C" },
          timeout: 15_000,
          maxBuffer: 64 * 1024
        }
      );
      ordinaryFile(temporaryBase, "临时网关私钥");
      ordinaryFile(`${temporaryBase}.pub`, "临时网关公钥");
      chmodSync(temporaryBase, 0o600);
      chmodSync(`${temporaryBase}.pub`, 0o644);
      renameSync(temporaryBase, privatePath);
      renameSync(`${temporaryBase}.pub`, publicPath);
    } catch (error) {
      for (const path of [temporaryBase, `${temporaryBase}.pub`]) {
        try {
          unlinkSync(path);
        } catch {
          // The temporary file may already have been renamed or never created.
        }
      }
      if (error instanceof CredentialError) throw error;
      throw new CredentialError("本机 ssh-keygen 生成网关凭据失败，请确认系统提供 ssh-keygen");
    }

    return { credentialRef, publicKey: publicKeyFrom(publicPath) };
  }

  removeGeneratedCredential(server: ServerRecord): boolean {
    const reference = server.credentialRef;
    if (!reference || reference !== generatedCredentialReference(server.id)) return false;
    let removed = false;
    for (const path of [this.pathForReference(reference), this.pathForReference(reference) + ".pub"]) {
      try {
        unlinkSync(path);
        removed = true;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      }
    }
    return removed;
  }
}
