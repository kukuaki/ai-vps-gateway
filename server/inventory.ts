import { basename, dirname } from "node:path";
import { redactText } from "./command-policy.js";
import type {
  RemoteInventoryProject,
  RemoteInventoryService,
  ServerInventory,
  DiscoveredProjectInput,
  ProjectServiceInput,
  ProjectRunbook,
  ProjectWebEndpoint,
  ServerRecord,
  ServiceManager,
  RemoteInventoryWebRoute
} from "./types.js";

export const INVENTORY_COMMAND = String.raw`set +e
printf '__AI_VPS_GATEWAY_INVENTORY_V2__\n'
printf 'META\thostname\t%s\n' "$(hostname 2>/dev/null)"
printf 'META\tos\t%s\n' "$(awk -F= '/^PRETTY_NAME=/{gsub(/"/, "", $2); print $2; exit}' /etc/os-release 2>/dev/null)"
printf 'META\tkernel\t%s\n' "$(uname -sr 2>/dev/null)"

DOCKER_MODE=unavailable
if command -v docker >/dev/null 2>&1; then
  if docker ps >/dev/null 2>&1; then
    DOCKER_MODE=direct
  elif command -v sudo >/dev/null 2>&1 && sudo -n docker ps >/dev/null 2>&1; then
    DOCKER_MODE=sudo
  fi
fi
if [ "$DOCKER_MODE" = "unavailable" ]; then
  if command -v docker >/dev/null 2>&1; then
    printf 'META\tdocker\tinstalled-but-inaccessible\n'
    printf 'WARNING\tdocker_permission\tDocker 已安装，但当前 SSH 用户无法读取 Docker socket；未读取容器详情\n'
  else
    printf 'META\tdocker\tunavailable\n'
  fi
else
  printf 'META\tdocker\tavailable\n'
  printf 'META\tdocker_mode\t%s\n' "$DOCKER_MODE"
fi

docker_read() {
  if [ "$DOCKER_MODE" = "sudo" ]; then
    sudo -n docker "$@"
  else
    docker "$@"
  fi
}

if [ "$DOCKER_MODE" != "unavailable" ]; then
  docker_read ps --format '{{.Names}}' 2>/dev/null | while IFS= read -r name; do
    [ -n "$name" ] || continue
    image=$(docker_read inspect -f '{{.Config.Image}}' "$name" 2>/dev/null)
    tags=$(docker_read inspect -f '{{range .RepoTags}}{{.}} {{end}}' "$name" 2>/dev/null)
    case "$image" in
      sha256:*|*@sha256:*) [ -n "$tags" ] && image=$(printf '%s' "$tags" | awk '{print $1}') ;;
    esac
    status=$(docker_read inspect -f '{{.State.Status}}{{if .State.Health}} / health={{.State.Health.Status}}{{end}}' "$name" 2>/dev/null)
    ports=$(docker_read port "$name" 2>/dev/null | awk 'NF {printf "%s%s", sep, $0; sep="; "}')
    exposed=$(docker_read inspect -f '{{range $port, $conf := .Config.ExposedPorts}}{{$port}} {{end}}' "$name" 2>/dev/null)
    project_path=$(docker_read inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$name" 2>/dev/null)
    project_hint=$(docker_read inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$name" 2>/dev/null)
    working_dir=$(docker_read inspect -f '{{.Config.WorkingDir}}' "$name" 2>/dev/null)
    mounts=$(docker_read inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}; {{end}}' "$name" 2>/dev/null)
    [ "$project_path" = "<no value>" ] && project_path=
    [ "$project_hint" = "<no value>" ] && project_hint=
    [ "$working_dir" = "<no value>" ] && working_dir=
    [ "$mounts" = "<no value>" ] && mounts=
    printf 'SERVICE\tdocker\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$image" "$status" "$ports" "$exposed" "$project_path" "$project_hint" "$working_dir" "$mounts"

    if [ -n "$working_dir" ]; then
      container_package=$(docker_read exec -w "$working_dir" "$name" node -e '
const fs = require("fs");
try {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const names = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}), ...(pkg.optionalDependencies || {}) })
    .sort()
    .slice(0, 120);
  process.stdout.write(String(pkg.name || "").replace(/[\t\r\n]/g, " ") + "\t" + names.join(","));
} catch {}
' 2>/dev/null)
      if [ -n "$container_package" ]; then
        printf 'CONTAINER_PACKAGE\t%s\t%s\n' "$name" "$container_package"
      fi
    fi

    case "$name $image" in
      *nginx*|*caddy*|*traefik*)
        container_routes=$(docker_read exec "$name" sh -c '
for root in /etc/nginx /etc/caddy /etc/traefik; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 5 -type f \( -name "*.conf" -o -name "Caddyfile" -o -name "*.yaml" -o -name "*.yml" \) -print 2>/dev/null
done | sort -u | while IFS= read -r path; do
  grep -hE "^[[:space:]]*(server_name|listen|proxy_pass|root)[[:space:]]" "$path" 2>/dev/null | cut -c1-500 | while IFS= read -r line; do
    printf "%s\t%s\n" "$path" "$line"
  done
done
' 2>/dev/null)
        if [ -n "$container_routes" ]; then
          printf '%s\n' "$container_routes" | while IFS= read -r route; do
            [ -n "$route" ] || continue
            printf 'WEB\tdocker:%s\t%s\n' "$name" "$route"
          done
        fi
        ;;
    esac
  done
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --state=running --no-legend --no-pager 2>/dev/null | awk '{print $1}' | while IFS= read -r unit; do
    [ -n "$unit" ] || continue
    state=$(systemctl show "$unit" -p ActiveState -p SubState --value 2>/dev/null | awk 'NF {printf "%s%s", sep, $0; sep=" / "}')
    fragment=$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null)
    workdir=$(systemctl show "$unit" -p WorkingDirectory --value 2>/dev/null)
    printf 'SERVICE\tsystemd\t%s\t%s\t\t\t%s\t\t%s\t\n' "$unit" "$state" "$fragment" "$workdir"
  done
fi

process_ports() {
  if command -v ss >/dev/null 2>&1; then
    ss -lntpH 2>/dev/null |
      awk -v process_pid="$1" 'index($0, "pid=" process_pid ",") {print $4}' |
      sort -u |
      awk 'NF {printf "%s%s", separator, $0; separator=";"}'
  fi
}

PM2_ROWS=
if command -v pm2 >/dev/null 2>&1; then
  PM2_ROWS=$(pm2 list --no-color 2>/dev/null | awk -F '│' '
function trim(value) {
  gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
  return value
}
$2 ~ /^[[:space:]]*[0-9]+[[:space:]]*$/ {
  id = trim($2)
  name = trim($3)
  pid = trim($7)
  status = trim($10)
  if (name != "" && pid ~ /^[0-9]+$/ && pid != "0") {
    printf "%s\t%s\t%s\t%s\n", id, name, pid, status
  }
}')
fi

if [ -n "$PM2_ROWS" ]; then
  tab=$(printf '\t')
  printf '%s\n' "$PM2_ROWS" | while IFS="$tab" read -r pm_id pm_name pm_pid pm_status; do
    [ -n "$pm_name" ] || continue
    workdir=$(readlink -f "/proc/$pm_pid/cwd" 2>/dev/null)
    ports=$(process_ports "$pm_pid")
    printf 'SERVICE\tprocess\tpm2:%s\t%s\t%s\t%s\t%s\t%s\t%s\t\n' "$pm_name" "$pm_name" "$pm_status" "$ports" "$workdir" "$pm_name" "$workdir"
  done
elif command -v ps >/dev/null 2>&1; then
  ps -eo pid=,comm= 2>/dev/null | awk '$2 ~ /^(node|npm|pm2)$/ {print $1 "\t" $2}' | while IFS="$(printf '\t')" read -r process_pid process_command; do
    [ -n "$process_pid" ] || continue
    workdir=$(readlink -f "/proc/$process_pid/cwd" 2>/dev/null)
    case "$workdir" in
      /opt/*|/srv/*|/var/www/*|/home/*|/root/*) ;;
      *) continue ;;
    esac
    case "$workdir" in
      */.pm2|*/node_modules/pm2|*/node_modules/pm2/*) continue ;;
    esac
    ports=$(process_ports "$process_pid")
    project_hint=$(basename "$workdir")
    printf 'SERVICE\tprocess\tpid:%s\t%s · %s\t%s\t%s\t%s\t%s\t%s\t\n' "$process_pid" "$process_command" "$project_hint" "running" "$ports" "$workdir" "$project_hint" "$workdir"
  done
fi

if command -v ss >/dev/null 2>&1; then
  ss -lntuH 2>/dev/null | awk '{print "PORT\t"$1"\t"$5}'
elif command -v netstat >/dev/null 2>&1; then
  netstat -lntu 2>/dev/null | awk 'NR > 2 {print "PORT\t"$1"\t"$4}'
fi

for root in /opt /srv /var/www /home /root; do
  if [ -d "$root" ]; then
    find "$root" -maxdepth 6 \( -path '*/.cache/*' -o -path '*/.git/*' -o -path '*/.nvm/*' -o -path '*/.npm/*' -o -path '*/node_modules/*' -o -path '*/.ssh/*' \) -prune -o -type f \( -name docker-compose.yml -o -name docker-compose.yaml -o -name compose.yml -o -name compose.yaml -o -name package.json -o -name pyproject.toml -o -name go.mod \) -print 2>/dev/null
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
  if [ "$kind" = "node" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY' 2>/dev/null
import json, sys
path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    raise SystemExit(0)
names = []
for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
    value = data.get(key, {})
    if isinstance(value, dict):
        names.extend(str(name) for name in value.keys())
names = sorted(set(names))[:120]
name = str(data.get("name", ""))[:120].replace("\t", " ")
print("PACKAGE\t{}\t{}\t{}".format(path.replace("\t", " "), name, ",".join(names)))
PY
  fi
done

for root in /etc/nginx /etc/*/nginx; do
  [ -d "$root" ] || continue
  find -L "$root" -maxdepth 5 \
    \( -path "$root/sites-available" -o -path "$root/sites-available/*" \) -prune -o \
    -type f \( -name '*.conf' -o -path "$root/sites-enabled/*" \) -print 2>/dev/null
done | sort -u | while IFS= read -r path; do
  awk '
function brace_delta(value, copy, opened, closed) {
  copy = value
  opened = gsub(/\{/, "", copy)
  copy = value
  closed = gsub(/\}/, "", copy)
  return opened - closed
}
{
  line = $0
  sub(/[[:space:]]*#.*/, "", line)
  if (!inside) {
    if (line ~ /^[[:space:]]*server[[:space:]]*\{/) {
      scope += 1
      depth = brace_delta(line)
      inside = 1
    }
    next
  }
  if (line ~ /^[[:space:]]*(server_name|listen|proxy_pass|root)[[:space:]]/) {
    gsub(/[\t\r]/, " ", line)
    printf "%s#server-%d\t%s\n", FILENAME, scope, substr(line, 1, 500)
  }
  depth += brace_delta(line)
  if (depth <= 0) {
    depth = 0
    inside = 0
  }
}
' "$path"
done | while IFS= read -r route; do
  [ -n "$route" ] || continue
  printf 'WEB\tnginx\t%s\n' "$route"
done`;

const HEADERS = new Set(["__AI_VPS_GATEWAY_INVENTORY_V1__", "__AI_VPS_GATEWAY_INVENTORY_V2__"]);
const MAX_FIELD_LENGTH = 500;
const SYSTEMD_BASELINE_UNITS = /^(?:accounts-daemon|acpid|apparmor|atd|auditd|chrony|cloud-(?:config|final|init|init-local)|console-getty|containerd|cron|dbus|docker|emergency|finalrd|fwupd|getty(?:@.*)?|irqbalance|iscsid|kmod|ModemManager|multipathd|NetworkManager|networkd|networkd-dispatcher|packagekit|polkit|rpcbind|rsyslog|serial-getty(?:@.*)?|snap\..*|snapd|ssh|sshd|systemd-[^.]+|tat_agent|udisks2|ufw|unattended-upgrades|unified-monitoring-agent|upower|user@.*|wpa_supplicant)\.service$/i;

function cleanField(value: string | undefined | null, maxLength = MAX_FIELD_LENGTH): string {
  if (!value) return "";
  return redactText(value.replace(/[\r\n\t]+/g, " ").trim(), maxLength).value;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0 && value <= 65_535))].sort((left, right) => left - right);
}

function normalizedProjectName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function normalizedProjectPath(path: string): string {
  const cleanPath = cleanField(path, 320);
  if (!cleanPath.startsWith("/")) return "";
  const releaseMatch = /^(.*)\/(?:releases?|deployments?)\/[^/]+(?:\/.*)?$/.exec(cleanPath);
  return releaseMatch?.[1] ?? cleanPath;
}

function projectDisplayName(path: string, fallback: string): string {
  if (/(?:^|[^a-z])(?:s-ui|x-ui|sui)(?:$|[^a-z])/i.test(path + " " + fallback)) return "S-UI";
  return cleanField(fallback || basename(path) || path, 100);
}

function projectFromManifest(serverId: string, kind: string, path: string): RemoteInventoryProject | null {
  const cleanPath = cleanField(path);
  if (!cleanPath.startsWith("/") || cleanPath.length < 2) return null;
  const directory = normalizedProjectPath(dirname(cleanPath));
  const manifest = basename(cleanPath);
  const key = `${serverId}:${directory}`;
  return {
    key,
    name: projectDisplayName(directory, basename(directory) || directory),
    path: directory,
    manifest: `${kind}:${manifest}`,
    technologyStack: [],
    webEndpoints: []
  };
}

function projectFromProcessService(serverId: string, service: RemoteInventoryService): RemoteInventoryProject | null {
  if (service.manager !== "process") return null;
  const hint = cleanField(service.projectHint ?? "", 100);
  const path = normalizedProjectPath(service.workingDirectory ?? service.projectPath ?? "");
  if (!hint || !path || /^(?:app|node|npm|pm2|server|process|unknown)$/i.test(hint)) return null;
  return {
    key: serverId + ":" + path,
    name: projectDisplayName(path, hint),
    path,
    manifest: "process:" + service.identifier,
    technologyStack: [],
    webEndpoints: []
  };
}

function mergeProject(projects: Map<string, RemoteInventoryProject>, project: RemoteInventoryProject): void {
  const existing = projects.get(project.key);
  if (!existing) {
    projects.set(project.key, project);
    return;
  }
  existing.manifest = unique([...existing.manifest.split(","), project.manifest]).join(",");
  existing.name = projectDisplayName(existing.path, existing.name || project.name);
}

function isNestedApplicationManifest(project: RemoteInventoryProject, candidates: RemoteInventoryProject[]): boolean {
  if (!/(?:node:package\.json|python:pyproject\.toml|go:go\.mod)/.test(project.manifest)) return false;
  return candidates.some((candidate) => candidate.path && candidate.path !== project.path && project.path.startsWith(candidate.path + "/"));
}

function belongsToProject(project: RemoteInventoryProject, service: RemoteInventoryService): boolean {
  const pathCandidate = service.manager === "docker"
    ? service.projectPath
    : service.workingDirectory ?? service.projectPath;
  const servicePath = normalizedProjectPath(pathCandidate ?? "");
  if (servicePath && project.path && (servicePath === project.path || servicePath.startsWith(project.path + "/"))) return true;
  const projectName = normalizedProjectName(project.name);
  const hint = normalizedProjectName(service.projectHint ?? "");
  if (hint && (hint === projectName || projectName.includes(hint) || hint.includes(projectName))) return true;
  const serviceName = normalizedProjectName(service.name + service.identifier + (service.image ?? ""));
  if (projectName.length >= 3 && serviceName.includes(projectName)) return true;
  const projectTokens = unique((project.name + " " + basename(project.path)).split(/[^a-z0-9\u4e00-\u9fff]+/i))
    .map(normalizedProjectName)
    .filter((token) => token.length >= 5);
  return projectTokens.some((token) => serviceName.includes(token));
}

function dockerGroupForService(name: string, image: string | null, allServices: RemoteInventoryService[]): string {
  const value = (name + " " + (image ?? "")).toLowerCase();
  if (value.includes("s-ui") || /(?:^|[-_])(?:sui|x-ui)(?:$|[-_])/.test(value)) return "s-ui";
  const cleanName = name.replace(/^\//, "");
  const prefix = cleanName.split(/[-_]/)[0] ?? cleanName;
  const samePrefix = allServices.filter((service) => service.manager === "docker" && service.name.replace(/^\//, "").split(/[-_]/)[0] === prefix);
  return samePrefix.length > 1 && prefix.length >= 3 ? prefix : cleanName;
}

function dockerProjectHint(service: RemoteInventoryService, allServices: RemoteInventoryService[]): string {
  return service.projectHint || dockerGroupForService(service.name, service.image, allServices);
}

function serviceFromFields(fields: string[]): RemoteInventoryService | null {
  const manager = fields[1] as ServiceManager | undefined;
  const identifier = cleanField(fields[2]);
  if (!identifier || (manager !== "docker" && manager !== "systemd" && manager !== "process" && manager !== "external")) return null;
  if (manager === "systemd" && SYSTEMD_BASELINE_UNITS.test(identifier)) return null;
  if (manager === "docker") {
    const oldFormat = fields.length < 9;
    const ports = cleanField(fields[5]) || null;
    const exposed = oldFormat ? "" : cleanField(fields[6]);
    return {
      manager,
      name: identifier.replace(/^\//, ""),
      identifier,
      image: cleanField(fields[3]) || null,
      status: cleanField(fields[4]),
      ports: ports || exposed || null,
      portMappings: unique([
        ...(ports?.split(/;\s*/).filter(Boolean) ?? []),
        ...exposed.split(/\s+/).filter(Boolean).map((port) => "内部: " + port)
      ]),
      projectPath: normalizedProjectPath(cleanField(oldFormat ? fields[6] : fields[7])) || null,
      projectHint: oldFormat ? null : cleanField(fields[8]) || null,
      workingDirectory: oldFormat ? null : cleanField(fields[9]) || null,
      mounts: oldFormat ? [] : unique(cleanField(fields[10]).split(/;\s*/))
    };
  }
  if (manager === "process") {
    const ports = cleanField(fields[5]) || null;
    return {
      manager,
      name: cleanField(fields[3], 120) || identifier,
      identifier,
      image: null,
      status: cleanField(fields[4]),
      ports,
      portMappings: unique((ports ?? "").split(/;\s*/).filter(Boolean).map((port) => "监听: " + port)),
      projectPath: normalizedProjectPath(cleanField(fields[6])) || null,
      projectHint: cleanField(fields[7]) || null,
      workingDirectory: cleanField(fields[8]) || null,
      mounts: []
    };
  }
  return {
    manager,
    name: identifier.replace(/\.service$/, ""),
    identifier,
    image: null,
    status: cleanField(fields[3]),
    ports: null,
    portMappings: [],
    projectPath: normalizedProjectPath(cleanField(fields[6])) || null,
    projectHint: null,
    workingDirectory: cleanField(fields[8]) || null,
    mounts: []
  };
}

function firstPort(value: string | null): number | null {
  const match = value?.match(/(?:^|[^\d])(\d{1,5})(?:->|\/tcp|\/udp|\s|$)/);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1 && port <= 65_535 ? port : null;
}

function serviceListensOnPort(service: RemoteInventoryService, port: number): boolean {
  const values = [service.ports ?? "", ...service.portMappings];
  return values.some((value) => {
    const hostPorts = [...value.matchAll(/:(\d{1,5})(?=\/(?:tcp|udp)|\s|;|$)/gi)].map((match) => Number(match[1]));
    const declaredPorts = [...value.matchAll(/(?:^|[\s;])(\d{1,5})\/(?:tcp|udp)(?=\s|;|$)/gi)].map((match) => Number(match[1]));
    return [...hostPorts, ...declaredPorts].includes(port);
  });
}

function inferStack(kind: string, manifest: string, dependencies: string[] = []): string[] {
  const values = new Set<string>();
  if (kind === "docker" || manifest.toLowerCase().includes("compose")) values.add("Docker Compose");
  if (kind === "node") values.add("Node.js");
  if (kind === "python") values.add("Python");
  if (kind === "go") values.add("Go");
  const rules: Array<[RegExp, string]> = [
    [/^(?:next|@next\/)/, "Next.js"],
    [/^(?:react|react-dom|@types\/react)/, "React"],
    [/^typescript$/, "TypeScript"],
    [/tailwind/, "Tailwind CSS"],
    [/prisma/, "Prisma"],
    [/^(?:pg|postgres|@types\/pg)/, "PostgreSQL"],
    [/pgvector/, "pgvector"],
    [/^(?:express|fastify|koa|hono)$/, "Node Web API"],
    [/^(?:vue|@vitejs\/plugin-vue)/, "Vue"],
    [/^vite$/, "Vite"],
    [/^zod$/, "Zod"]
  ];
  for (const dependency of dependencies.map((item) => item.toLowerCase())) {
    for (const [pattern, label] of rules) if (pattern.test(dependency)) values.add(label);
  }
  return [...values];
}

function addStack(project: RemoteInventoryProject, values: string[]): void {
  project.technologyStack = unique([...project.technologyStack, ...values]).sort((left, right) => left.localeCompare(right));
}

function upstreamPortOf(upstream: string | null): number | null {
  if (!upstream || upstream.includes("$")) return null;
  try {
    const parsed = new URL(upstream);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 0;
    return port >= 1 && port <= 65_535 ? port : null;
  } catch {
    const match = /:(\d{1,5})(?:\/|$)/.exec(upstream);
    const port = Number(match?.[1] ?? 0);
    return port >= 1 && port <= 65_535 ? port : null;
  }
}

function endpointFromRoute(route: RemoteInventoryWebRoute, hostname: string): ProjectWebEndpoint | null {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) return null;
  if (!route.upstream && route.root && /(?:^|\/)(?:acme|letsencrypt|certbot)(?:\/|$)/i.test(route.root)) return null;
  const port = route.ports.includes(443) ? 443 : route.ports[0] ?? 80;
  const details = [
    route.upstream ? "上游：" + route.upstream : null,
    route.root ? "静态目录：" + route.root : null,
    route.configPath ? "配置摘要：" + route.configPath : null
  ].filter((value): value is string => Boolean(value));
  return {
    label: hostname,
    url: (port === 443 ? "https://" : "http://") + hostname,
    port,
    serviceName: route.serviceName,
    notes: details.join("；"),
    source: "remote-inventory"
  };
}

function hasPublicTcpPortMapping(service: RemoteInventoryService, port: number): boolean {
  const mapping = new RegExp(`(?:^|[;\\s])${port}/tcp\\s*->\\s*(?:0\\.0\\.0\\.0|\\[::\\]|::):${port}(?:$|[;\\s])`, "i");
  return service.portMappings.some((value) => mapping.test(value));
}

function sUiPanelEndpoints(project: RemoteInventoryProject, server: ServerRecord, services: RemoteInventoryService[]): ProjectWebEndpoint[] {
  const projectValue = `${project.name} ${project.manifest}`;
  const isSuiProject = /(?:^|[^a-z])s-?ui(?:$|[^a-z])/i.test(projectValue) || services.some((service) =>
    /(?:^|[^a-z])s-?ui(?:$|[^a-z])/i.test(`${service.name} ${service.image ?? ""}`)
  );
  if (!isSuiProject) return [];
  const host = server.address.includes(":") && !server.address.startsWith("[") ? `[${server.address}]` : server.address;
  return services
    .filter((service) => /(?:^|[^a-z])s-?ui(?:$|[^a-z])/i.test(`${service.name} ${service.image ?? ""}`))
    .filter((service) => hasPublicTcpPortMapping(service, 2095))
    .map((service) => ({
      label: "S-UI 管理面板",
      url: `http://${host}:2095/app/`,
      port: 2095,
      serviceName: service.name,
      notes: "S-UI 默认管理路径；由公网 Docker 端口映射识别，请确认登录认证和防火墙策略。",
      source: "remote-inventory" as const
    }));
}

function dedupeEndpoints(endpoints: ProjectWebEndpoint[]): ProjectWebEndpoint[] {
  const result = new Map<string, ProjectWebEndpoint>();
  for (const endpoint of endpoints) {
    const existing = result.get(endpoint.url);
    // Prefer a route-associated record over the generic health-check record for the same public URL.
    if (!existing || (!existing.serviceName && endpoint.serviceName)) result.set(endpoint.url, endpoint);
  }
  return [...result.values()].sort((left, right) => left.url.localeCompare(right.url));
}

function endpointHostname(endpoint: ProjectWebEndpoint): string | null {
  try {
    return new URL(endpoint.url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function serviceInput(server: ServerRecord, service: RemoteInventoryService): ProjectServiceInput {
  const publicPort = firstPort(service.ports);
  const details = [
    service.status ? "状态：" + service.status : null,
    service.image ? "镜像：" + service.image : null,
    service.portMappings.length ? "端口映射：" + service.portMappings.join("；") : null,
    service.workingDirectory ? "工作目录：" + service.workingDirectory : null,
    service.mounts.length ? "挂载：" + service.mounts.join("；") : null,
    "来源：" + server.name + " 的只读 SSH 盘点"
  ].filter((value): value is string => Boolean(value));
  return {
    serverId: server.id,
    name: service.name.slice(0, 100),
    manager: service.manager,
    identifier: service.identifier.slice(0, 160),
    port: publicPort,
    portMappings: service.portMappings,
    accessUrl: null,
    critical: Boolean(service.portMappings.some((mapping) => /(?:^|[^\d])(?:80|443)(?:->|\/tcp|\s|$)/.test(mapping)) || /(?:postgres|database|nginx|web|s-ui)/i.test(service.name + " " + (service.image ?? ""))),
    notes: details.join("\n")
  };
}

function runbookFor(server: ServerRecord, inventory: ServerInventory, projectPath: string | null, services: RemoteInventoryService[], technologyStack: string[], endpoints: ProjectWebEndpoint[]): ProjectRunbook {
  const location = projectPath ?? "远程主机当前登记的服务";
  const serviceNames = services.map((service) => service.name);
  const endpointText = endpoints.length ? endpoints.map((endpoint) => endpoint.url + (endpoint.port ? " (:" + endpoint.port + ")" : "")).join("、") : "无已确认 Web 入口";
  const endpointChains = endpoints
    .map((endpoint) => endpoint.url + (endpoint.serviceName ? " -> " + endpoint.serviceName : "") + (endpoint.notes ? "；" + endpoint.notes : ""))
    .join("；") || "未确认域名到运行服务的转发链路";
  const stackText = technologyStack.length ? technologyStack.join("、") : "尚未识别技术栈";
  const portText = unique(services.flatMap((service) => service.portMappings)).join("、") || "未读取到服务端口映射";
  return {
    overview: "自动盘点记录，运行节点：" + server.name + "。位置：" + location + "。主机：" +
      (inventory.hostname ?? "未知") + "；系统：" + (inventory.os ?? "未知") + "；内核：" +
      (inventory.kernel ?? "未知") + "。技术栈：" + stackText + "。Web 入口：" + endpointText + "。入口链路：" + endpointChains + "。这份档案由网关只读采集生成，未读取密钥、环境变量、业务数据或完整配置。",
    deployment: "当前仅记录远程现状，不自动执行部署。变更前先确认项目路径、服务管理器、监听端口和回滚方式；涉及 " +
      (serviceNames.join("、") || "未识别服务") + " 时通过网关独占会话操作。容器内部和宿主端口映射：" + portText + "。涉及数据库、Web 入口、代理节点或线上数据目录时先确认备份和回滚。",
    verification: "变更后依次检查服务状态、监听端口和访问地址；再运行网关测活与当前性能采集。当前盘点发现的监听端口：" +
      (inventory.listeningPorts.join("、") || "未读取到") + "。Web 检查目标：" + endpointText + "。",
    troubleshooting: "先看网关最近会话和命令记录，再按服务排查：" + (serviceNames.join("、") || "项目服务") + "。Docker 检查容器状态、镜像、挂载和端口；systemd 检查 unit、FragmentPath 和 WorkingDirectory；Web 异常检查 Nginx 路由与上游；数据库异常先确认状态、磁盘和备份，再决定是否重启。不要把 Token、密码、私钥或完整环境变量写入 Runbook。",
    guardrails: "自动发现不等于完整架构。数据库服务与数据卷、SSH/防火墙/代理入口、80/443 及已确认公网端口、竞赛/支付服务和未知目录不得随意改动。停止、重启、迁移、清理镜像/卷、改 DNS 或安全组前，先说明影响、备份和回滚方式。"
  };
}

function isNginxService(service: RemoteInventoryService): boolean {
  return /(?:^|[^a-z])nginx(?:[^a-z]|$)/i.test(service.name + " " + service.identifier);
}

function isSingBoxService(service: RemoteInventoryService): boolean {
  return /sing[-_ ]?box/i.test(service.name + " " + service.identifier);
}

function isNginxRoute(route: RemoteInventoryWebRoute): boolean {
  return /(?:^|:)nginx(?:$|[:_-])/i.test(route.source);
}

function isLoopbackUpstream(upstream: string | null): boolean {
  if (!upstream) return false;
  try {
    const hostname = new URL(upstream).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return /^(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$)/i.test(upstream);
  }
}

function isSingBoxProxyRoute(route: RemoteInventoryWebRoute): boolean {
  return isNginxRoute(route) && isLoopbackUpstream(route.upstream) && Boolean(route.upstreamPort);
}

function projectRepresentsSingBox(project: RemoteInventoryProject, services: RemoteInventoryService[]): boolean {
  if (/sing[-_ ]?box/i.test(project.name + " " + project.manifest)) return true;
  return services.some((service) => isSingBoxService(service) && belongsToProject(project, service));
}

function unresolvedServiceGroups(inventory: ServerInventory, services: RemoteInventoryService[]): RemoteInventoryService[][] {
  const unassignedRouteManagers = services.filter(isNginxService);
  const applicationGroups = services.filter((service) => !isNginxService(service)).map((service) => [service]);
  const attachedManagers = new Set<RemoteInventoryService>();

  for (const route of inventory.webRoutes) {
    if (!route.upstream && !route.serviceName) continue;
    const routeServices = servicesForRoute(route, inventory.services);
    const managers = routeServices.filter(isNginxService);
    const upstreams = routeServices.filter((service) => !isNginxService(service) && services.includes(service));
    for (const upstream of upstreams) {
      const group = applicationGroups.find((candidate) => candidate.includes(upstream));
      if (!group) continue;
      for (const manager of managers) {
        if (!group.includes(manager)) group.push(manager);
        attachedManagers.add(manager);
      }
    }
  }

  const singBoxServices = services.filter(isSingBoxService);
  if (singBoxServices.length === 1) {
    const group = applicationGroups.find((candidate) => candidate.includes(singBoxServices[0]!));
    for (const route of inventory.webRoutes.filter(isSingBoxProxyRoute)) {
      const routeServices = servicesForRoute(route, inventory.services);
      const upstreams = routeServices.filter((service) => !isNginxService(service));
      if (upstreams.length && !upstreams.every(isSingBoxService)) continue;
      for (const manager of routeServices.filter(isNginxService)) {
        if (group && !group.includes(manager)) group.push(manager);
        attachedManagers.add(manager);
      }
    }
  }

  return [
    ...applicationGroups,
    ...unassignedRouteManagers.filter((service) => !attachedManagers.has(service)).map((service) => [service])
  ];
}

function routeMatchesProject(
  project: RemoteInventoryProject,
  route: RemoteInventoryWebRoute,
  services: RemoteInventoryService[],
  inventoryServices: RemoteInventoryService[]
): boolean {
  const projectToken = normalizedProjectName(project.name);
  const hintToken = normalizedProjectName(route.projectHint ?? "");
  const routeToken = normalizedProjectName(route.configPath + " " + (route.upstream ?? "") + " " + (route.serviceName ?? ""));
  if (hintToken && (hintToken === projectToken || projectToken.includes(hintToken) || hintToken.includes(projectToken))) return true;
  if (projectToken.length >= 3 && routeToken.includes(projectToken)) return true;
  const pathMatches = Boolean(project.path && [route.configPath, route.root]
    .filter((value): value is string => Boolean(value))
    .some((value) => value === project.path || value.startsWith(project.path + "/")));
  if (pathMatches) return true;
  if (isSingBoxProxyRoute(route) && projectRepresentsSingBox(project, services) &&
    services.some(isNginxService) && services.some(isSingBoxService)) {
    const identifiedUpstreams = servicesForRoute(route, inventoryServices).filter((service) => !isNginxService(service));
    if (!identifiedUpstreams.length || identifiedUpstreams.every(isSingBoxService)) return true;
  }
  return services.some((service) => belongsToProject(project, service) && (
    service.name === route.serviceName ||
    Boolean(route.upstreamPort && serviceListensOnPort(service, route.upstreamPort))
  ));
}

function servicesForRoute(route: RemoteInventoryWebRoute, services: RemoteInventoryService[]): RemoteInventoryService[] {
  const result = new Set<RemoteInventoryService>();
  const routeServiceName = route.source.startsWith("docker:") ? route.source.slice("docker:".length) : route.source;
  for (const service of services) {
    const serviceToken = normalizedProjectName(service.name);
    const identifierToken = normalizedProjectName(service.identifier);
    const routeServiceToken = normalizedProjectName(routeServiceName);
    const isRouteManager = Boolean(routeServiceToken && (serviceToken === routeServiceToken || identifierToken === routeServiceToken));
    const isUpstream = Boolean(
      (route.serviceName && service.name === route.serviceName) ||
      (route.upstreamPort && serviceListensOnPort(service, route.upstreamPort))
    );
    if (isRouteManager || isUpstream) result.add(service);
  }
  return [...result];
}

function servicesForProject(project: RemoteInventoryProject, inventory: ServerInventory): RemoteInventoryService[] {
  const result = new Set(inventory.services.filter((service) => belongsToProject(project, service)));
  const matchingRoutes = inventory.webRoutes.filter((route) => routeMatchesProject(project, route, inventory.services, inventory.services));
  for (const route of matchingRoutes) {
    for (const service of servicesForRoute(route, inventory.services)) result.add(service);
  }
  return [...result];
}

function endpointsForProject(
  project: RemoteInventoryProject,
  server: ServerRecord,
  inventory: ServerInventory,
  services: RemoteInventoryService[]
): ProjectWebEndpoint[] {
  const endpoints = [...project.webEndpoints];
  for (const route of inventory.webRoutes) {
    if (!routeMatchesProject(project, route, services, inventory.services)) continue;
    for (const hostname of route.hostnames) {
      const endpoint = endpointFromRoute(route, hostname);
      if (endpoint) endpoints.push(endpoint);
    }
  }
  // A server health check proves reachability, not ownership of a project Web entry.
  return dedupeEndpoints([...endpoints, ...sUiPanelEndpoints(project, server, services)]);
}

function inferredTechnologyStack(project: RemoteInventoryProject, services: RemoteInventoryService[]): string[] {
  const stack = [...project.technologyStack];
  for (const service of services) {
    if (service.manager === "docker") stack.push("Docker");
    if (service.manager === "systemd") stack.push("systemd");
    if (service.manager === "process") stack.push("Node.js");
    const value = (service.name + " " + (service.image ?? "")).toLowerCase();
    if (value.includes("nginx")) stack.push("Nginx");
    if (service.identifier.startsWith("pm2:") || value.includes("pm2")) stack.push("PM2");
    if (value.includes("postgres")) stack.push("PostgreSQL");
    if (value.includes("pgvector")) stack.push("pgvector");
    if (value.includes("s-ui") || value.includes("sui")) stack.push("S-UI");
    if (value.includes("sing-box")) stack.push("sing-box");
  }
  return unique(stack).sort((left, right) => left.localeCompare(right));
}

function syntheticDockerProject(serverId: string, group: string, services: RemoteInventoryService[]): RemoteInventoryProject {
  const path = services.map((service) => service.projectPath ?? service.workingDirectory ?? "").find((value) => value.startsWith("/")) ?? "";
  const project: RemoteInventoryProject = {
    key: serverId + ":docker:" + group,
    name: group === "s-ui" ? "S-UI" : group,
    path,
    manifest: "docker:" + group,
    technologyStack: [],
    webEndpoints: []
  };
  addStack(project, ["Docker"]);
  if (group === "s-ui") addStack(project, ["S-UI"]);
  return project;
}

function syntheticServiceProject(serverId: string, services: RemoteInventoryService[]): RemoteInventoryProject {
  if (!services.length) throw new Error("无法为空服务组生成项目");
  const service = services.find(isSingBoxService) ?? services.find((item) => !isNginxService(item)) ?? services[0];
  return {
    key: serverId + ":service:" + service.manager + ":" + service.identifier,
    name: service.name,
    path: "",
    manifest: service.manager + ":" + service.identifier,
    technologyStack: [],
    webEndpoints: []
  };
}

export function discoveredProjectsForInventory(server: ServerRecord, inventory: ServerInventory): DiscoveredProjectInput[] {
  const projects = new Map<string, DiscoveredProjectInput>();
  const candidates = inventory.projects.filter((project) => !isNestedApplicationManifest(project, inventory.projects));
  const assigned = new Set<RemoteInventoryService>();

  for (const project of candidates) {
    const discoveredServices = servicesForProject(project, inventory);
    discoveredServices.forEach((service) => assigned.add(service));
    const technologyStack = inferredTechnologyStack(project, discoveredServices);
    const webEndpoints = endpointsForProject(project, server, inventory, discoveredServices);
    projects.set(project.key, {
      sourceKey: project.key,
      name: (server.name + " · " + project.name).slice(0, 100),
      description: "从 " + server.name + " 只读发现的 " + project.manifest + " 项目。已记录技术栈、运行服务、端口映射和可确认的 Web 入口，部署前继续补充仓库与数据边界。",
      repositoryPath: project.path || null,
      serverId: server.id,
      technologyStack,
      webEndpoints,
      runbook: runbookFor(server, inventory, project.path || null, discoveredServices, technologyStack, webEndpoints),
      services: discoveredServices.map((service) => serviceInput(server, service))
    });
  }

  const unassignedServices = inventory.services.filter((service) => !assigned.has(service));
  const dockerGroups = new Map<string, RemoteInventoryService[]>();
  for (const service of unassignedServices.filter((item) => item.manager === "docker")) {
    const group = dockerProjectHint(service, unassignedServices);
    const items = dockerGroups.get(group) ?? [];
    items.push(service);
    dockerGroups.set(group, items);
  }
  for (const [group, servicesForGroup] of dockerGroups) {
    const project = syntheticDockerProject(server.id, group, servicesForGroup);
    const technologyStack = inferredTechnologyStack(project, servicesForGroup);
    const webEndpoints = endpointsForProject(project, server, inventory, servicesForGroup);
    projects.set(project.key, {
      sourceKey: project.key,
      name: (server.name + " · " + project.name).slice(0, 100),
      description: "从 " + server.name + " 的 Docker 容器组自动归类。未发现 Compose 标签或明确项目目录，已根据容器名、镜像、挂载和端口生成可审阅档案。",
      repositoryPath: project.path || null,
      serverId: server.id,
      technologyStack,
      webEndpoints,
      runbook: runbookFor(server, inventory, project.path || null, servicesForGroup, technologyStack, webEndpoints),
      services: servicesForGroup.map((service) => serviceInput(server, service))
    });
    servicesForGroup.forEach((service) => assigned.add(service));
  }

  const stillUnassigned = inventory.services.filter((service) => !assigned.has(service));
  for (const servicesForProject of unresolvedServiceGroups(inventory, stillUnassigned)) {
    const project = syntheticServiceProject(server.id, servicesForProject);
    const technologyStack = inferredTechnologyStack(project, servicesForProject);
    const webEndpoints = endpointsForProject(project, server, inventory, servicesForProject);
    const serviceNames = servicesForProject.map((item) => item.name).join("、");
    const groupingNote = servicesForProject.length > 1
      ? "已按 Nginx 反向代理到本地服务的入口链路归并为同一项目。"
      : "未发现可关联的项目路径，已按服务名称建档。";
    projects.set(project.key, {
      sourceKey: project.key,
      name: (server.name + " · " + project.name).slice(0, 100),
      description: "从 " + server.name + " 只读发现的 " + serviceNames + " 服务。" + groupingNote,
      repositoryPath: null,
      serverId: server.id,
      technologyStack,
      webEndpoints,
      runbook: runbookFor(server, inventory, null, servicesForProject, technologyStack, webEndpoints),
      services: servicesForProject.map((item) => serviceInput(server, item))
    });
  }

  const matchedEndpoints = new Set<string>([...projects.values()].flatMap((project) => (project.webEndpoints ?? []).map((endpoint) => endpoint.url)));
  const matchedHostnames = new Set<string>(
    [...projects.values()]
      .flatMap((project) => project.webEndpoints ?? [])
      .map(endpointHostname)
      .filter((hostname): hostname is string => Boolean(hostname))
  );
  const fallbackEndpoints = [
    ...inventory.webRoutes.flatMap((route) => route.hostnames.map((hostname) => endpointFromRoute(route, hostname)))
  ].filter((endpoint): endpoint is ProjectWebEndpoint => Boolean(endpoint));
  for (const endpoint of fallbackEndpoints) {
    const key = endpoint.url;
    if (matchedEndpoints.has(key)) continue;
    const hostname = endpointHostname(endpoint);
    if (hostname && matchedHostnames.has(hostname)) continue;
    const sourceRoute = inventory.webRoutes.find((route) => route.hostnames.some((hostname) => endpoint.url.includes(hostname)));
    const routeServices = sourceRoute ? servicesForRoute(sourceRoute, inventory.services) : [];
    const upstreamServices = routeServices.filter((service) => !isNginxService(service));
    const fallbackProject = sourceRoute
      ? [...projects.values()].find((project) => upstreamServices.some((service) =>
        project.services?.some((item) => item.manager === service.manager && item.identifier === service.identifier)
      ))
      : undefined;
    if (fallbackProject && sourceRoute) {
      const knownServices = new Map((fallbackProject.services ?? []).map((service) => [service.manager + ":" + service.identifier, service]));
      for (const service of servicesForRoute(sourceRoute, inventory.services)) {
        const input = serviceInput(server, service);
        knownServices.set(input.manager + ":" + input.identifier, input);
      }
      fallbackProject.services = [...knownServices.values()];
      fallbackProject.webEndpoints = dedupeEndpoints([...(fallbackProject.webEndpoints ?? []), endpoint]);
      const fallbackRemoteProject: RemoteInventoryProject = {
        key: fallbackProject.sourceKey,
        name: fallbackProject.name,
        path: fallbackProject.repositoryPath ?? "",
        manifest: "remote-services",
        technologyStack: fallbackProject.technologyStack ?? [],
        webEndpoints: fallbackProject.webEndpoints
      };
      const fallbackServices = inventory.services.filter((service) => fallbackProject.services?.some((item) => item.identifier === service.identifier));
      fallbackProject.technologyStack = inferredTechnologyStack(fallbackRemoteProject, fallbackServices);
      fallbackProject.runbook = runbookFor(server, inventory, fallbackProject.repositoryPath ?? null, fallbackServices, fallbackProject.technologyStack, fallbackProject.webEndpoints);
      matchedEndpoints.add(key);
      if (hostname) matchedHostnames.add(hostname);
      continue;
    }
    const projectName = endpoint.label || endpoint.url;
    projects.set(server.id + ":web:" + projectName, {
      sourceKey: server.id + ":web:" + projectName,
      name: (server.name + " · " + projectName).slice(0, 100),
      description: "从 " + server.name + " 发现的 Web 入口，尚未关联到代码项目或运行服务。",
      repositoryPath: null,
      serverId: server.id,
      technologyStack: ["Web 入口"],
      webEndpoints: [endpoint],
      runbook: runbookFor(server, inventory, null, [], ["Web 入口"], [endpoint]),
      services: []
    });
    matchedEndpoints.add(key);
    if (hostname) matchedHostnames.add(hostname);
  }

  return [...projects.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parseInventoryOutput(serverId: string, output: string, collectedAt = new Date().toISOString()): ServerInventory {
  type PackageMetadata = { kind: string; path: string; name: string; dependencies: string[] };
  type ContainerPackageMetadata = { containerName: string; dependencies: string[] };
  type RouteState = {
    source: string;
    configPath: string;
    hostnames: Set<string>;
    ports: Set<number>;
    upstreams: Set<string>;
    roots: Set<string>;
  };
  const metadata = new Map<string, string>();
  const projects = new Map<string, RemoteInventoryProject>();
  const services = new Map<string, RemoteInventoryService>();
  const packages: PackageMetadata[] = [];
  const containerPackages: ContainerPackageMetadata[] = [];
  const routeStates = new Map<string, RouteState>();
  const listeningPorts: string[] = [];
  const warnings: string[] = [];
  const lines = output.split(/\r?\n/);

  if (!lines.some((line) => HEADERS.has(line.trim()))) {
    warnings.push("远程盘点没有返回可识别的网关格式，可能是目标系统 Shell 不兼容");
  }

  for (const line of lines) {
    const fields = line.split("\t");
    const type = fields[0]?.trim();
    if (type === "META" && fields[1]) {
      metadata.set(fields[1], cleanField(fields.slice(2).join("\t")));
      continue;
    }
    if (type === "WARNING" && fields[2]) {
      warnings.push(cleanField(fields.slice(2).join("\t"), 1_000));
      continue;
    }
    if (type === "SERVICE") {
      const service = serviceFromFields(fields);
      if (service) services.set(service.manager + ":" + service.identifier, service);
      continue;
    }
    if (type === "PORT" && fields[1]) {
      listeningPorts.push(cleanField(fields.slice(1).join("\t"), 120));
      continue;
    }
    if (type === "PROJECT") {
      const project = projectFromManifest(serverId, fields[1] ?? "unknown", fields.slice(2).join("\t"));
      if (project) mergeProject(projects, project);
      continue;
    }
    if (type === "PACKAGE" && fields[2]) {
      packages.push({
        kind: cleanField(fields[1], 40),
        path: cleanField(fields[2], 320),
        name: cleanField(fields[3], 120),
        dependencies: unique(cleanField(fields[4], 2_000).split(","))
      });
      continue;
    }
    if (type === "CONTAINER_PACKAGE" && fields[1]) {
      containerPackages.push({
        containerName: cleanField(fields[1], 120),
        dependencies: unique(cleanField(fields[3], 2_000).split(","))
      });
      continue;
    }
    if (type !== "WEB" || !fields[2] || !fields[3]) continue;
    const routeKey = cleanField(fields[2], 320);
    const configPath = routeKey.replace(/#server-\d+$/, "");
    const route = routeStates.get(routeKey) ?? {
      source: cleanField(fields[1], 40) || "web",
      configPath,
      hostnames: new Set<string>(),
      ports: new Set<number>(),
      upstreams: new Set<string>(),
      roots: new Set<string>()
    };
    const directive = cleanField(fields.slice(3).join("\t"), 600).replace(/#.*$/, "").trim();
    const serverNames = /^server_name\s+(.+?);?$/i.exec(directive);
    if (serverNames) {
      for (const hostname of serverNames[1].replace(/;$/, "").split(/\s+/)) {
        if (/^(?:_|localhost|default_server|\d{1,3}(?:\.\d{1,3}){3})$/i.test(hostname)) continue;
        if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) route.hostnames.add(hostname);
      }
    }
    const listen = /^listen\s+(.+?);?$/i.exec(directive);
    if (listen) {
      for (const match of listen[1].matchAll(/(?:^|\s)(\d{1,5})(?:\s|$)/g)) {
        const port = Number(match[1]);
        if (port >= 1 && port <= 65_535) route.ports.add(port);
      }
    }
    const proxyPass = /^proxy_pass\s+(\S+);?$/i.exec(directive);
    if (proxyPass) route.upstreams.add(proxyPass[1].replace(/;$/, ""));
    const root = /^root\s+(\S+);?$/i.exec(directive);
    if (root) route.roots.add(root[1].replace(/;$/, ""));
    routeStates.set(routeKey, route);
  }

  const serviceValues = [...services.values()];
  for (const service of serviceValues) {
    if (service.manager === "docker") {
      service.projectPath = normalizedProjectPath(service.projectPath ?? "") || null;
      service.projectHint = dockerProjectHint(service, serviceValues);
    }
  }
  for (const service of serviceValues) {
    const project = projectFromProcessService(serverId, service);
    if (!project) continue;
    const parentProject = [...projects.values()].find((candidate) =>
      candidate.path && (project.path === candidate.path || project.path.startsWith(candidate.path + "/"))
    );
    if (!parentProject) mergeProject(projects, project);
  }

  for (const packageInfo of packages) {
    const project = projectFromManifest(serverId, packageInfo.kind, packageInfo.path);
    if (!project) continue;
    mergeProject(projects, project);
    const target = projects.get(project.key);
    if (!target) continue;
    addStack(target, inferStack(packageInfo.kind, packageInfo.path, packageInfo.dependencies));
  }
  for (const project of projects.values()) {
    for (const manifest of project.manifest.split(",")) addStack(project, inferStack(manifest.split(":")[0] ?? "", manifest));
  }

  const webRoutes: RemoteInventoryWebRoute[] = [...routeStates.values()].map((route) => {
    const upstream = [...route.upstreams][0] ?? null;
    const upstreamHost = upstream?.replace(/^[a-z]+:\/\//i, "").split(/[/:]/)[0] ?? null;
    const upstreamPort = upstreamPortOf(upstream);
    const upstreamToken = normalizedProjectName(upstreamHost ?? "");
    const hostService = upstreamHost
      ? serviceValues.find((item) =>
        item.name === upstreamHost ||
        item.identifier === upstreamHost ||
        (Boolean(upstreamToken) && (normalizedProjectName(item.name) === upstreamToken || normalizedProjectName(item.identifier) === upstreamToken))
      )
      : undefined;
    const portService = upstreamPort ? serviceValues.find((item) => serviceListensOnPort(item, upstreamPort)) : undefined;
    const service = hostService ?? portService;
    const root = [...route.roots][0] ?? null;
    const rootProject = root
      ? [...projects.values()].find((project) => project.path && (root === project.path || root.startsWith(project.path + "/")))
      : undefined;
    const projectHint = service?.projectHint ?? rootProject?.name ?? null;
    return {
      source: route.source,
      configPath: route.configPath,
      hostnames: [...route.hostnames].sort(),
      ports: uniqueNumbers([...route.ports]),
      upstream,
      upstreamPort,
      root,
      serviceName: service?.name ?? upstreamHost,
      projectHint
    };
  }).filter((route) => route.hostnames.length || route.upstream || route.root);

  for (const project of projects.values()) {
    const matchingRoutes = webRoutes.filter((route) => routeMatchesProject(project, route, serviceValues, serviceValues));
    project.webEndpoints = dedupeEndpoints(
      matchingRoutes
        .flatMap((route) => route.hostnames.map((hostname) => endpointFromRoute(route, hostname)))
        .filter((endpoint): endpoint is ProjectWebEndpoint => Boolean(endpoint))
    );
  }

  const assigned = new Set<RemoteInventoryService>();
  for (const project of projects.values()) {
    for (const service of serviceValues) if (belongsToProject(project, service)) assigned.add(service);
  }
  const groups = new Map<string, RemoteInventoryService[]>();
  for (const service of serviceValues.filter((item) => item.manager === "docker" && !assigned.has(item))) {
    const group = dockerProjectHint(service, serviceValues);
    const list = groups.get(group) ?? [];
    list.push(service);
    groups.set(group, list);
  }
  for (const [group, groupServices] of groups) {
    const project = syntheticDockerProject(serverId, group, groupServices);
    addStack(project, groupServices.flatMap((service) => inferStack("", service.name + " " + (service.image ?? ""))));
    projects.set(project.key, project);
  }

  for (const packageInfo of containerPackages) {
    const service = serviceValues.find((item) => item.name === packageInfo.containerName || item.identifier === packageInfo.containerName);
    if (!service) continue;
    const project = [...projects.values()].find((candidate) => belongsToProject(candidate, service));
    if (project) addStack(project, inferStack("node", "package.json", packageInfo.dependencies));
  }

  const finalProjects = [...projects.values()];
  const inventoryContext: ServerInventory = {
    serverId,
    collectedAt,
    hostname: metadata.get("hostname") || null,
    os: metadata.get("os") || null,
    kernel: metadata.get("kernel") || null,
    dockerAvailable: metadata.get("docker") === "available",
    projects: finalProjects,
    services: serviceValues,
    webRoutes,
    listeningPorts: unique(listeningPorts).sort(),
    warnings
  };
  for (const project of finalProjects) {
    const projectServices = servicesForProject(project, inventoryContext);
    addStack(project, inferredTechnologyStack(project, projectServices));
  }

  return {
    ...inventoryContext,
    projects: finalProjects.sort((left, right) => (left.path + ":" + left.name).localeCompare(right.path + ":" + right.name)),
    services: serviceValues.sort((left, right) => (left.manager + ":" + left.name).localeCompare(right.manager + ":" + right.name))
  };
}
