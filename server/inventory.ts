import { basename, dirname } from "node:path";
import { redactText } from "./command-policy.js";
import type {
  RemoteInventoryProject,
  RemoteInventoryService,
  ServerInventory,
  DiscoveredProjectInput,
  ProjectServiceInput,
  ProjectRunbook,
  ServerRecord,
  ServiceManager
} from "./types.js";

export const INVENTORY_COMMAND = String.raw`set +e
printf '__AI_VPS_GATEWAY_INVENTORY_V1__\n'
printf 'META\thostname\t%s\n' "$(hostname 2>/dev/null)"
printf 'META\tos\t%s\n' "$(awk -F= '/^PRETTY_NAME=/{gsub(/"/, "", $2); print $2; exit}' /etc/os-release 2>/dev/null)"
printf 'META\tkernel\t%s\n' "$(uname -sr 2>/dev/null)"
if command -v docker >/dev/null 2>&1; then
  printf 'META\tdocker\tavailable\n'
  docker ps --format 'SERVICE\tdocker\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null
else
  printf 'META\tdocker\tunavailable\n'
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print "SERVICE\tsystemd\t"$1"\t"$4"\t"$3}'
fi
if command -v ss >/dev/null 2>&1; then
  ss -lntH 2>/dev/null | awk '{print "PORT\t"$4}'
elif command -v netstat >/dev/null 2>&1; then
  netstat -lnt 2>/dev/null | awk 'NR > 2 {print "PORT\t"$4}'
fi
for root in /opt /srv /var/www /home /root; do
  if [ -d "$root" ]; then
    find "$root" -maxdepth 3 \( -path '*/.cache/*' -o -path '*/.git/*' -o -path '*/.nvm/*' -o -path '*/.npm/*' -o -path '*/node_modules/*' \) -prune -o -type f \( -name docker-compose.yml -o -name docker-compose.yaml -o -name compose.yml -o -name compose.yaml -o -name package.json -o -name pyproject.toml -o -name go.mod \) -print 2>/dev/null
  fi
done | sort -u | while IFS= read -r path; do
  case "$path" in
    */docker-compose.yml|*/docker-compose.yaml|*/compose.yml|*/compose.yaml) kind=docker ;;
    */package.json) kind=node ;;
    */pyproject.toml) kind=python ;;
    */go.mod) kind=go ;;
    *) kind=unknown ;;
  esac
  printf 'PROJECT\t%s\t%s\n' "$kind" "$path"
done
`;

const HEADER = "__AI_VPS_GATEWAY_INVENTORY_V1__";
const MAX_FIELD_LENGTH = 240;
const SYSTEMD_BASELINE_UNITS = /^(?:accounts-daemon|apparmor|atd|auditd|cloud-(?:config|final|init|final)|console-getty|cron|dbus|emergency|finalrd|getty|irqbalance|kmod|ModemManager|multipathd|NetworkManager|networkd|packagekit|polkit|rsyslog|serial-getty|snapd|ssh|sshd|systemd-[^.]+|systemd-userdbd|ufw|unattended-upgrades|user@|wpa_supplicant)\.service$/i;

function cleanField(value: string | undefined | null): string {
  if (!value) return "";
  return redactText(value.replace(/[\r\n\t]+/g, " ").trim(), MAX_FIELD_LENGTH).value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function projectFromManifest(serverId: string, kind: string, path: string): RemoteInventoryProject | null {
  const cleanPath = cleanField(path);
  if (!cleanPath.startsWith("/") || cleanPath.length < 2) return null;
  const directory = dirname(cleanPath);
  const manifest = basename(cleanPath);
  const key = `${serverId}:${directory}`;
  return {
    key,
    name: cleanField(basename(directory) || directory),
    path: directory,
    manifest: `${kind}:${manifest}`
  };
}

function isNestedApplicationManifest(project: RemoteInventoryProject, candidates: RemoteInventoryProject[]): boolean {
  if (!/^(?:node:package\.json|python:pyproject\.toml|go:go\.mod)$/.test(project.manifest)) return false;
  return candidates.some((candidate) => candidate.path !== project.path && project.path.startsWith(candidate.path + "/"));
}

function normalizedProjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function belongsToProject(project: RemoteInventoryProject, service: RemoteInventoryService): boolean {
  if (service.projectPath === project.path) return true;
  const projectName = normalizedProjectName(project.name);
  const serviceName = normalizedProjectName(service.name + service.identifier);
  return projectName.length >= 5 && serviceName.includes(projectName);
}

function serviceFromFields(fields: string[]): RemoteInventoryService | null {
  const manager = fields[1] as ServiceManager | undefined;
  const identifier = cleanField(fields[2]);
  if (!identifier || (manager !== "docker" && manager !== "systemd" && manager !== "process" && manager !== "external")) return null;
  if (manager === "systemd" && SYSTEMD_BASELINE_UNITS.test(identifier)) return null;
  if (manager === "docker") {
    return {
      manager,
      name: identifier,
      identifier,
      image: cleanField(fields[3]) || null,
      status: cleanField(fields[4]),
      ports: cleanField(fields[5]) || null,
      projectPath: cleanField(fields[6]) || null
    };
  }
  return {
    manager,
    name: identifier.replace(/\.service$/, ""),
    identifier,
    image: null,
    status: cleanField(fields[3]),
    ports: null,
    projectPath: null
  };
}

function firstPort(value: string | null): number | null {
  const match = value?.match(/:(\d{1,5})(?:->|,|\s|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65_535 ? port : null;
}

function serviceInput(server: ServerRecord, service: RemoteInventoryService): ProjectServiceInput {
  const publicPort = firstPort(service.ports);
  const details = [
    service.status ? "状态：" + service.status : null,
    service.image ? "镜像：" + service.image : null,
    service.ports ? "监听映射：" + service.ports : null,
    "来源：" + server.name + " 的只读 SSH 盘点"
  ].filter((value): value is string => Boolean(value));
  return {
    serverId: server.id,
    name: service.name.slice(0, 100),
    manager: service.manager,
    identifier: service.identifier.slice(0, 160),
    port: publicPort,
    accessUrl: null,
    critical: Boolean(service.ports?.match(/:(?:80|443)(?:->|,|\s|$)/)),
    notes: details.join("\n")
  };
}

function runbookFor(server: ServerRecord, inventory: ServerInventory, projectPath: string | null, services: RemoteInventoryService[]): ProjectRunbook {
  const location = projectPath ?? "远程主机当前登记的服务";
  const serviceNames = services.map((service) => service.name);
  return {
    overview: "自动盘点记录，运行节点：" + server.name + "。位置：" + location + "。主机：" +
      (inventory.hostname ?? "未知") + "；系统：" + (inventory.os ?? "未知") + "；内核：" +
      (inventory.kernel ?? "未知") + "。这份档案由网关只读采集生成，部署前需要人工补充真实仓库、依赖和数据边界。",
    deployment: "当前仅记录远程现状，不自动执行部署。变更前先确认项目路径、服务管理器、监听端口和回滚方式；涉及 " +
      (serviceNames.join("、") || "未识别服务") + " 时通过网关独占会话操作。",
    verification: "变更后依次检查服务状态、监听端口和访问地址；再运行网关测活与当前性能采集。当前盘点发现的监听端口：" +
      (inventory.listeningPorts.join("、") || "未读取到") + "。",
    troubleshooting: "先查看服务管理器状态和最近审计，再检查监听端口、磁盘和内存。Docker 项目检查容器状态与 Compose 文件；systemd 项目检查对应 unit。不要把 Token、密码或完整环境变量写入 Runbook。",
    guardrails: "这是自动发现档案，不能据此推断完整架构。不要删除未知目录、数据库卷或线上关键服务；先确认项目归属、端口用途和备份状态，再进行停止、重启、迁移或清理。"
  };
}

export function discoveredProjectsForInventory(server: ServerRecord, inventory: ServerInventory): DiscoveredProjectInput[] {
  const projects = new Map<string, DiscoveredProjectInput>();
  const candidates = inventory.projects.filter((project) => !isNestedApplicationManifest(project, inventory.projects));
  const assigned = new Set<RemoteInventoryService>();
  for (const project of candidates) {
    const discoveredServices = inventory.services.filter((service) => belongsToProject(project, service));
    discoveredServices.forEach((service) => assigned.add(service));
    const services = discoveredServices.map((service) => serviceInput(server, service));
    projects.set(project.key, {
      sourceKey: project.key,
      name: (server.name + " · " + project.name).slice(0, 100),
      description: "从 " + server.name + " 只读发现的 " + project.manifest + " 项目，需人工确认后补充完整运维资料。",
      repositoryPath: project.path,
      serverId: server.id,
      runbook: runbookFor(server, inventory, project.path, discoveredServices),
      services
    });
  }

  const unassigned = inventory.services.filter((service) => !assigned.has(service));
  if (unassigned.length) {
    projects.set(server.id + ":unassigned", {
      sourceKey: server.id + ":unassigned",
      name: (server.name + " · 未归类服务").slice(0, 100),
      description: "从 " + server.name + " 只读发现但尚未能关联到项目路径的服务。",
      repositoryPath: null,
      serverId: server.id,
      runbook: runbookFor(server, inventory, null, unassigned),
      services: unassigned.map((service) => serviceInput(server, service))
    });
  }
  return [...projects.values()];
}

export function parseInventoryOutput(serverId: string, output: string, collectedAt = new Date().toISOString()): ServerInventory {
  const metadata = new Map<string, string>();
  const projects = new Map<string, RemoteInventoryProject>();
  const services = new Map<string, RemoteInventoryService>();
  const listeningPorts: string[] = [];
  const warnings: string[] = [];
  const lines = output.split(/\r?\n/);

  if (!lines.some((line) => line.trim() === HEADER)) {
    warnings.push("远程盘点没有返回可识别的网关格式，可能是目标系统 Shell 不兼容");
  }

  for (const line of lines) {
    const fields = line.split("\t");
    const type = fields[0]?.trim();
    if (type === "META" && fields[1]) {
      metadata.set(fields[1], cleanField(fields.slice(2).join("\t")));
      continue;
    }
    if (type === "SERVICE") {
      const service = serviceFromFields(fields);
      if (service) services.set(`${service.manager}:${service.identifier}`, service);
      continue;
    }
    if (type === "PORT" && fields[1]) {
      listeningPorts.push(cleanField(fields.slice(1).join("\t")));
      continue;
    }
    if (type === "PROJECT") {
      const project = projectFromManifest(serverId, fields[1] ?? "unknown", fields.slice(2).join("\t"));
      if (project) projects.set(project.key, project);
    }
  }

  for (const service of services.values()) {
    if (service.manager === "docker" && service.projectPath && !service.projectPath.startsWith("/")) {
      service.projectPath = null;
    }
  }

  return {
    serverId,
    collectedAt,
    hostname: metadata.get("hostname") || null,
    os: metadata.get("os") || null,
    kernel: metadata.get("kernel") || null,
    dockerAvailable: metadata.get("docker") === "available",
    projects: [...projects.values()].sort((left, right) => left.path.localeCompare(right.path)),
    services: [...services.values()].sort((left, right) => `${left.manager}:${left.name}`.localeCompare(`${right.manager}:${right.name}`)),
    listeningPorts: unique(listeningPorts).sort(),
    warnings
  };
}
