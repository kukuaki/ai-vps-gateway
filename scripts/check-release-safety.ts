import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sensitiveFilePattern = /(?:^|\/)(?:\.env(?:\..*)?|known_hosts|[^/]+\.(?:sqlite(?:-(?:shm|wal))?|db|key|pem|p12|pfx|crt))$/i;
const forbiddenDirectoryPattern = /(?:^|\/)(?:data|credentials|release|dist|dist-electron|node_modules)(?:\/|$)/i;
const privateKeyBlockPattern = /-----BEGIN [^-\r\n]+-----[\s\S]{16,}?-----END [^-\r\n]+-----/i;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function isReservedIpv4(address: string): boolean {
  const [first, second, third, fourth] = address.split(".").map(Number);
  if (![first, second, third, fourth].every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) return false;
  return first === 0 || first === 10 || first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113);
}

function candidateFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: projectDirectory,
    encoding: "utf8"
  });
  return output.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
}

const findings: string[] = [];
for (const relativePath of candidateFiles()) {
  if (forbiddenDirectoryPattern.test(relativePath)) {
    findings.push(`${relativePath}: 禁止进入发布候选集的运行时或构建目录`);
    continue;
  }
  if (sensitiveFilePattern.test(relativePath) && !relativePath.endsWith(".env.example")) {
    findings.push(`${relativePath}: 禁止进入发布候选集的敏感文件名`);
    continue;
  }

  let content: string;
  try {
    const filePath = resolve(projectDirectory, relativePath);
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
    const bytes = readFileSync(filePath);
    if (bytes.includes(0)) continue;
    content = bytes.toString("utf8");
  } catch {
    findings.push(`${relativePath}: 无法读取发布候选文件`);
    continue;
  }

  if (privateKeyBlockPattern.test(content)) findings.push(`${relativePath}: 发现完整私钥块`);
  for (const address of content.match(ipv4Pattern) ?? []) {
    if (!isReservedIpv4(address)) findings.push(`${relativePath}: 发现非保留 IPv4 地址 ${address}`);
  }
}

if (findings.length) {
  console.error("Release safety check failed:");
  for (const finding of [...new Set(findings)]) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Release safety check passed for ${candidateFiles().length} candidate files.`);
}
