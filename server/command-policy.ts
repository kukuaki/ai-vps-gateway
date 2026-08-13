import type { CommandRisk } from "./types.js";

export const MAX_COMMAND_LENGTH = 20_000;
export const MAX_OUTPUT_BYTES = 128 * 1024;

export interface CommandAssessment {
  risk: CommandRisk;
  blocked: boolean;
  reason: string | null;
  signals: string[];
}

const hardBlockRules: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*(?:&\s*)?\}\s*;?/i,
    reason: "检测到 fork bomb 形式的命令"
  },
  {
    pattern: /\b(?:mkfs(?:\.[a-z0-9_-]+)?|wipefs|blkdiscard)\b/i,
    reason: "文件系统或块设备擦除命令被网关阻断"
  },
  {
    pattern: /\b(?:fdisk|sfdisk|parted)\b[\s\S]*\/dev\//i,
    reason: "磁盘分区修改命令被网关阻断"
  },
  {
    pattern: /\bdd\b[\s\S]*\bof\s*=\s*['"]?\/dev\//i,
    reason: "向块设备写入的 dd 命令被网关阻断"
  },
  {
    pattern: /\b(?:shred|cat|tee|printf|echo)\b[\s\S]*(?:>|>>|of=)\s*['"]?\/dev\/(?:sd[a-z]|nvme\d+n\d+|vd[a-z]|xvd[a-z]|mmcblk\d+)/i,
    reason: "直接破坏块设备的写入命令被网关阻断"
  }
];

function normalizedCommand(command: string): string {
  return command
    .toLowerCase()
    .replace(/(['"])([^'"\r\n]*)\1\s*(['"])([^'"\r\n]*)\3/g, "$2$4")
    .replace(/\\[\s\n]*/g, "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsRootRecursiveDelete(command: string): boolean {
  if (!/\brm\b/i.test(command)) return false;
  const hasRecursiveFlag = /(?:^|\s)-[^\s]*r|--recursive/i.test(command);
  if (!hasRecursiveFlag) return false;
  return /(?:^|[\s"'=;|&])\/(?:\s|\*|$|["';|&])/i.test(command) || /--no-preserve-root/i.test(command) && /\brm\b/i.test(command);
}

function containsRootFindDelete(command: string): boolean {
  return /\bfind\s+(?:--\s+)?['"]?\/['"]?(?:\s|$)[\s\S]*\s-delete(?:\s|$)/i.test(command);
}

export function assessCommand(command: string): CommandAssessment {
  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      risk: "critical",
      blocked: true,
      reason: `命令长度超过 ${MAX_COMMAND_LENGTH} 个字符`,
      signals: ["command_length"]
    };
  }
  if (command.includes("\u0000")) {
    return { risk: "critical", blocked: true, reason: "命令包含禁止的 NUL 字符", signals: ["invalid_input"] };
  }

  const normalized = normalizedCommand(command);
  const matchedRule = hardBlockRules.find((rule) => rule.pattern.test(normalized));
  if (matchedRule || containsRootRecursiveDelete(normalized) || containsRootFindDelete(normalized)) {
    return {
      risk: "critical",
      blocked: true,
      reason: matchedRule?.reason ?? "递归删除根目录的命令被网关阻断",
      signals: ["absolute_denylist"]
    };
  }

  const signals: string[] = [];
  const signalRules: Array<[string, RegExp]> = [
    ["privilege_escalation", /\b(?:sudo|su|doas|pkexec)\b/i],
    ["service_control", /\b(?:systemctl|service|launchctl)\s+(?:stop|restart|reload|disable|mask|kill|start)\b/i],
    ["container_mutation", /\bdocker\s+(?:rm|rmi|kill|stop|restart|system\s+prune|volume\s+rm)\b/i],
    ["firewall_change", /\b(?:iptables|ip6tables|nft|ufw|firewall-cmd)\b/i],
    ["host_power", /\b(?:reboot|shutdown|poweroff|halt)\b/i],
    ["file_mutation", /(?:^|\s)(?:rm|mv|cp|install|chmod|chown|ln|truncate)\b/i],
    ["package_change", /\b(?:apt(?:-get)?|dnf|yum|apk|pacman|brew)\s+(?:install|remove|purge|upgrade|update|dist-upgrade)\b/i],
    ["source_reset", /\bgit\s+(?:reset\s+--hard|clean\s+-f|checkout\s+--)\b/i],
    ["remote_script", /(?:curl|wget)\b[\s\S]*(?:\||\b(?:sh|bash|zsh|python|node)\b)/i],
    ["shell_evaluation", /\b(?:eval|exec|bash\s+-c|sh\s+-c|python(?:3)?\s+-c|node\s+-e)\b/i],
    ["network_change", /\b(?:ip\s+(?:addr|route|link)|route|ifconfig)\b/i]
  ];
  for (const [signal, pattern] of signalRules) {
    if (pattern.test(normalized)) signals.push(signal);
  }

  const risk: CommandRisk = signals.some((signal) => ["privilege_escalation", "host_power", "firewall_change"].includes(signal))
    ? "critical"
    : signals.length
      ? "high"
      : "normal";
  return { risk, blocked: false, reason: null, signals };
}

export function redactText(value: string, maxBytes = MAX_OUTPUT_BYTES): { value: string; truncated: boolean } {
  let redacted = value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, "[REDACTED_PEM]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "[REDACTED_TOKEN]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/(\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp(?:s)?)?:\/\/[^\s:/@]+:)([^\s/@]+)(@)/gi, "$1[REDACTED]$3")
    .replace(/(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)([^\s,;&]+)/gi, "$1[REDACTED]")
    .replace(/(["']?(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|bearer|database[_-]?url|db[_-]?url|jwt)["']?\s*[=:]\s*)(["'])([\s\S]*?)\2/gi, "$1$2[REDACTED]$2")
    .replace(/(\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|bearer|database[_-]?url|db[_-]?url|jwt)\b\s*[=:]\s*)([^\s,;&]+)/gi, "$1[REDACTED]")
    .replace(/(\b(?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|bearer|database[_-]?url|db[_-]?url|jwt)\b\s+)([^\s,;&]+)/gi, "$1[REDACTED]");
  const bytes = Buffer.byteLength(redacted, "utf8");
  if (bytes <= maxBytes) return { value: redacted, truncated: false };
  const buffer = Buffer.from(redacted, "utf8");
  redacted = buffer.subarray(0, maxBytes).toString("utf8");
  return { value: `${redacted}\n[OUTPUT_TRUNCATED]`, truncated: true };
}

export function displayCommand(command: string): string {
  return redactText(command, MAX_COMMAND_LENGTH).value;
}
