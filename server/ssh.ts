import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { ServerRecord } from "./types.js";
import { MAX_OUTPUT_BYTES } from "./command-policy.js";
import { CredentialStore } from "./credentials.js";

export interface SshExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
  error: string | null;
}

export interface SshExecutorOptions {
  credentialStore?: CredentialStore;
  sshBinary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function boundedTimeout(value: number | undefined): number {
  return Math.min(Math.max(value ?? 10_000, 1_000), 600_000);
}

function appendChunk(current: string, chunk: Buffer, maxBytes: number): { value: string; truncated: boolean } {
  const currentBytes = Buffer.byteLength(current, "utf8");
  if (currentBytes >= maxBytes) return { value: current, truncated: true };
  const remaining = maxBytes - currentBytes;
  if (chunk.byteLength <= remaining) return { value: current + chunk.toString("utf8"), truncated: false };
  return { value: current + chunk.subarray(0, remaining).toString("utf8"), truncated: true };
}

export class SshExecutor {
  readonly credentialStore: CredentialStore;
  private readonly sshBinary: string;
  private readonly defaultTimeoutMs: number;
  private readonly maxOutputBytes: number;

  constructor(options: SshExecutorOptions = {}) {
    this.credentialStore = options.credentialStore ?? new CredentialStore();
    this.sshBinary = options.sshBinary ?? process.env.ALLVPS_SSH_BIN ?? "ssh";
    this.defaultTimeoutMs = boundedTimeout(options.timeoutMs);
    this.maxOutputBytes = Math.min(Math.max(options.maxOutputBytes ?? MAX_OUTPUT_BYTES, 1_024), 4 * 1024 * 1024);
  }

  async execute(server: ServerRecord, command: string, timeoutMs = this.defaultTimeoutMs): Promise<SshExecutionResult> {
    const credentialPath = this.credentialStore.pathFor(server);
    if (!this.credentialStore.hasKnownHosts()) {
      throw new Error("本机没有可用的 SSH known_hosts，网关拒绝在未校验主机指纹的情况下连接");
    }

    const startedAt = Date.now();
    const args = [
      "-F",
      "/dev/null",
      "-T",
      "-n",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "PasswordAuthentication=no",
      "-o",
      "KbdInteractiveAuthentication=no",
      "-o",
      "ChallengeResponseAuthentication=no",
      "-o",
      "RequestTTY=no",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      `UserKnownHostsFile=${this.credentialStore.knownHostsPath}`,
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      "UpdateHostkeys=no",
      "-o",
      "VerifyHostKeyDNS=no",
      "-o",
      "ProxyCommand=none",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ConnectionAttempts=1",
      "-p",
      String(server.sshPort),
      "-i",
      credentialPath,
      `${server.sshUser}@${server.address}`,
      command
    ];
    const environment: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: homedir(),
      LANG: "C",
      LC_ALL: "C"
    };
    if (process.env.SSH_AUTH_SOCK) environment.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;

    return new Promise<SshExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let outputTruncated = false;
      let timedOut = false;
      let spawnError: string | null = null;
      let settled = false;
      const child = spawn(this.sshBinary, args, { env: environment, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      const timeout = boundedTimeout(timeoutMs);
      let killTimer: NodeJS.Timeout | null = null;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      }, timeout);
      timer.unref();

      const finish = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        resolve({
          exitCode,
          stdout,
          stderr,
          outputTruncated,
          durationMs: Math.max(0, Date.now() - startedAt),
          timedOut,
          error: spawnError
        });
      };

      child.stdout.on("data", (chunk: Buffer) => {
        const result = appendChunk(stdout, chunk, this.maxOutputBytes);
        stdout = result.value;
        outputTruncated ||= result.truncated;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const result = appendChunk(stderr, chunk, this.maxOutputBytes);
        stderr = result.value;
        outputTruncated ||= result.truncated;
      });
      child.once("error", (error: Error) => {
        spawnError = error.message;
        finish(null);
      });
      child.once("close", (code) => finish(code));
    });
  }
}
