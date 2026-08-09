<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  Activity,
  Archive,
  ArrowUpRight,
  BellRing,
  ChevronLeft,
  CircleAlert,
  CircleCheckBig,
  Clock3,
  FolderKanban,
  FolderSync,
  Gauge,
  Globe2,
  LayoutDashboard,
  Network,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  X
} from "@lucide/vue";
import { api } from "./api";
import type {
  AllVpsSyncPreview,
  AuditEvent,
  DashboardResponse,
  ProjectDetail,
  ProjectPayload,
  ProjectRecord,
  ProjectRunbook,
  ServerDetail,
  ServerPayload,
  ServerRecord,
  ServerStatus,
  ServiceManager,
  SessionDetail,
  SessionRecord
} from "./types";

type ViewName = "overview" | "servers" | "projects" | "audit";

const activeView = ref<ViewName>("overview");
const dashboard = ref<DashboardResponse | null>(null);
const auditEvents = ref<AuditEvent[]>([]);
const selected = ref<ServerDetail | null>(null);
const isLoading = ref(true);
const isSaving = ref(false);
const isProbing = ref<string | null>(null);
const notice = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const query = ref("");
const showEditor = ref(false);
const editingId = ref<string | null>(null);
const syncPreview = ref<AllVpsSyncPreview | null>(null);
const showSyncDialog = ref(false);
const isSyncing = ref(false);
const projects = ref<ProjectRecord[]>([]);
const selectedProject = ref<ProjectDetail | null>(null);
const sessions = ref<SessionRecord[]>([]);
const selectedSession = ref<SessionDetail | null>(null);
const showProjectEditor = ref(false);
const editingProjectId = ref<string | null>(null);
const isProjectSaving = ref(false);
const isSessionAction = ref(false);
const isCollectingMetrics = ref(false);
const isRootAction = ref(false);
const projectQuery = ref("");

interface FormState {
  name: string;
  address: string;
  sshPort: number;
  sshUser: string;
  credentialRef: string;
  role: string;
  environment: string;
  accessUrl: string;
  tags: string;
  maintenance: boolean;
  addHttpCheck: boolean;
  healthUrl: string;
  expectedStatusCodes: string;
}

interface ProjectServerForm {
  serverId: string;
  role: string;
}

interface ProjectServiceForm {
  serverId: string;
  name: string;
  manager: ServiceManager;
  identifier: string;
  port: string;
  accessUrl: string;
  critical: boolean;
  notes: string;
}

interface ProjectFormState {
  name: string;
  description: string;
  repositoryUrl: string;
  repositoryPath: string;
  runbook: ProjectRunbook;
  servers: ProjectServerForm[];
  services: ProjectServiceForm[];
}

const form = reactive<FormState>({
  name: "",
  address: "",
  sshPort: 22,
  sshUser: "ubuntu",
  credentialRef: "",
  role: "",
  environment: "production",
  accessUrl: "",
  tags: "",
  maintenance: false,
  addHttpCheck: false,
  healthUrl: "",
  expectedStatusCodes: "200"
});

const projectForm = reactive<ProjectFormState>({
  name: "",
  description: "",
  repositoryUrl: "",
  repositoryPath: "",
  runbook: emptyRunbook(),
  servers: [],
  services: []
});

const runbookSections: Array<{ key: keyof ProjectRunbook; label: string; placeholder: string }> = [
  { key: "overview", label: "项目概览", placeholder: "用途、架构、依赖和当前状态" },
  { key: "deployment", label: "部署步骤", placeholder: "发布前检查、部署命令和回滚顺序" },
  { key: "verification", label: "验证步骤", placeholder: "上线后需要检查的页面、端口、日志和数据" },
  { key: "troubleshooting", label: "排错手册", placeholder: "常见故障、日志位置、判断顺序和恢复方法" },
  { key: "guardrails", label: "变更边界", placeholder: "不可直接改动的端口、服务、目录和需要先确认的事项" }
];

const managerLabels: Record<ServiceManager, string> = {
  docker: "Docker",
  systemd: "systemd",
  process: "直接进程",
  external: "外部托管"
};

const statusMeta: Record<ServerStatus, { label: string; tone: string }> = {
  healthy: { label: "健康", tone: "healthy" },
  degraded: { label: "服务异常", tone: "degraded" },
  ssh_unreachable: { label: "SSH 不可达", tone: "unreachable" },
  offline: { label: "离线", tone: "offline" },
  maintenance: { label: "维护中", tone: "maintenance" },
  archived: { label: "已归档", tone: "archived" },
  unknown: { label: "待测活", tone: "unknown" }
};

const visibleServers = computed(() => {
  const servers = dashboard.value?.servers ?? [];
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return servers;
  return servers.filter((server) => [server.name, server.address, server.role, server.environment, ...server.tags].join(" ").toLowerCase().includes(keyword));
});

const visibleProjects = computed(() => {
  const keyword = projectQuery.value.trim().toLowerCase();
  if (!keyword) return projects.value;
  return projects.value.filter((project) => [project.name, project.description, project.repositoryUrl ?? "", project.repositoryPath ?? ""].join(" ").toLowerCase().includes(keyword));
});

const selectedServer = computed(() => selected.value?.server ?? null);
const selectedServerSession = computed(() => {
  const serverId = selectedServer.value?.id;
  return serverId ? sessions.value.find((session) => session.serverId === serverId) ?? null : null;
});
const isEditing = computed(() => editingId.value !== null);
const isProjectEditing = computed(() => editingProjectId.value !== null);

function emptyRunbook(): ProjectRunbook {
  return { overview: "", deployment: "", verification: "", troubleshooting: "", guardrails: "" };
}

function resetForm(): void {
  Object.assign(form, {
    name: "",
    address: "",
    sshPort: 22,
    sshUser: "ubuntu",
    credentialRef: "",
    role: "",
    environment: "production",
    accessUrl: "",
    tags: "",
    maintenance: false,
    addHttpCheck: false,
    healthUrl: "",
    expectedStatusCodes: "200"
  });
}

function notify(message: string): void {
  notice.value = message;
  window.setTimeout(() => {
    if (notice.value === message) notice.value = null;
  }, 4_000);
}

function humanTime(timestamp: string | null): string {
  if (!timestamp) return "尚未检查";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
}

function relativeTime(timestamp: string | null): string {
  if (!timestamp) return "未开始";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1_000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

function statusOf(status: ServerStatus): { label: string; tone: string } {
  return statusMeta[status];
}

function sessionStatusOf(status: SessionRecord["status"]): { label: string; tone: string } {
  return {
    active: { label: "执行中", tone: "healthy" },
    queued: { label: "排队中", tone: "degraded" },
    closed: { label: "已关闭", tone: "unknown" },
    expired: { label: "已过期", tone: "offline" }
  }[status];
}

function commandRiskLabel(risk: "normal" | "high" | "critical"): string {
  return { normal: "普通", high: "高危提示", critical: "阻断 / 极高危" }[risk];
}

function commandOutcomeLabel(outcome: "completed" | "failed" | "timed_out" | "blocked"): string {
  return { completed: "完成", failed: "失败", timed_out: "超时", blocked: "已阻断" }[outcome];
}

function emergencyRootActive(server: ServerRecord): boolean {
  return Boolean(server.emergencyRootUntil && Date.parse(server.emergencyRootUntil) > Date.now());
}

function syncActionLabel(action: AllVpsSyncPreview["changes"][number]["action"]): string {
  return { created: "新增", updated: "更新", unchanged: "无变更" }[action];
}

async function refresh(selectId?: string): Promise<void> {
  isLoading.value = !dashboard.value;
  errorMessage.value = null;
  try {
    const [nextDashboard, nextAudit, nextProjects, nextSessions] = await Promise.all([api.dashboard(), api.audit(), api.projects(), api.sessions()]);
    dashboard.value = nextDashboard;
    auditEvents.value = nextAudit.events;
    projects.value = nextProjects.projects;
    sessions.value = nextSessions.sessions;
    const targetId = selectId ?? selected.value?.server.id;
    if (targetId) selected.value = await api.server(targetId).catch(() => null);
    const existingSession = selectedSession.value;
    const sessionId = existingSession && existingSession.serverId === targetId
      ? existingSession.id
      : sessions.value.find((session) => session.serverId === targetId)?.id;
    selectedSession.value = sessionId ? await api.session(sessionId).then((result) => result.session).catch(() => null) : null;
    const projectId = selectedProject.value?.id;
    if (projectId) selectedProject.value = await api.project(projectId).then((result) => result.project).catch(() => null);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法连接本机网关";
  } finally {
    isLoading.value = false;
  }
}

async function openProject(project: ProjectRecord): Promise<void> {
  try {
    selectedProject.value = (await api.project(project.id)).project;
    activeView.value = "projects";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取项目详情失败";
  }
}

async function openServer(server: ServerRecord): Promise<void> {
  try {
    selected.value = await api.server(server.id);
    const session = sessions.value.find((item) => item.serverId === server.id);
    selectedSession.value = session ? await api.session(session.id).then((result) => result.session).catch(() => null) : null;
    activeView.value = "servers";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取 VPS 详情失败";
  }
}

async function openAiSession(server: ServerRecord): Promise<void> {
  isSessionAction.value = true;
  errorMessage.value = null;
  try {
    const result = await api.openSession(server.id, "webui");
    notify(result.session.status === "active" ? `${server.name} 会话已开启` : `${server.name} 已进入排队，第 ${result.session.queuePosition} 位`);
    await refresh(server.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法开启会话";
  } finally {
    isSessionAction.value = false;
  }
}

async function closeAiSession(): Promise<void> {
  const sessionId = selectedServerSession.value?.id;
  if (!sessionId) return;
  isSessionAction.value = true;
  errorMessage.value = null;
  try {
    const result = await api.closeSession(sessionId);
    notify(result.promoted ? "会话已释放，排队请求已交接" : "会话已释放");
    await refresh(selectedServer.value?.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法关闭会话";
  } finally {
    isSessionAction.value = false;
  }
}

async function grantEmergencyRoot(server: ServerRecord): Promise<void> {
  if (!window.confirm(`将为 ${server.name} 开启 30 分钟紧急 root 救援，期间 AI 会话可直接使用 root SSH。继续？`)) return;
  isRootAction.value = true;
  errorMessage.value = null;
  try {
    await api.grantEmergencyRoot(server.id);
    notify(`${server.name} 的紧急 root 救援已开启 30 分钟`);
    await refresh(server.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法开启紧急 root 救援";
  } finally {
    isRootAction.value = false;
  }
}

async function revokeEmergencyRoot(server: ServerRecord): Promise<void> {
  isRootAction.value = true;
  errorMessage.value = null;
  try {
    await api.revokeEmergencyRoot(server.id);
    notify(`${server.name} 的紧急 root 救援已关闭`);
    await refresh(server.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法关闭紧急 root 救援";
  } finally {
    isRootAction.value = false;
  }
}

async function collectMetrics(server: ServerRecord): Promise<void> {
  isCollectingMetrics.value = true;
  errorMessage.value = null;
  try {
    const sessionId = selectedServerSession.value?.status === "active" ? selectedServerSession.value.id : undefined;
    await api.collectMetrics(server.id, sessionId);
    selected.value = await api.server(server.id);
    notify(selected.value.metric?.source === "ssh" ? `${server.name} 性能已更新` : "当前性能暂不可用，详情已记录");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "性能采集失败";
  } finally {
    isCollectingMetrics.value = false;
  }
}

function openCreate(): void {
  resetForm();
  editingId.value = null;
  showEditor.value = true;
}

function openEdit(server: ServerRecord): void {
  const httpCheck = server.healthChecks.find((check) => check.kind === "http");
  Object.assign(form, {
    name: server.name,
    address: server.address,
    sshPort: server.sshPort,
    sshUser: server.sshUser,
    credentialRef: server.credentialRef ?? "",
    role: server.role,
    environment: server.environment,
    accessUrl: server.accessUrl ?? "",
    tags: server.tags.join(", "),
    maintenance: server.maintenance,
    addHttpCheck: Boolean(httpCheck),
    healthUrl: httpCheck?.config.url ?? "",
    expectedStatusCodes: httpCheck?.config.expectedStatusCodes?.join(", ") ?? "200"
  });
  editingId.value = server.id;
  showEditor.value = true;
}

function serverPayload(): ServerPayload {
  const codes = form.expectedStatusCodes
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599);
  const healthChecks = form.addHttpCheck && form.healthUrl.trim()
    ? [{
        name: "Public HTTP",
        kind: "http" as const,
        enabled: true,
        config: { url: form.healthUrl.trim(), expectedStatusCodes: codes.length ? codes : [200] }
      }]
    : [];
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    sshPort: Number(form.sshPort),
    sshUser: form.sshUser.trim(),
    credentialRef: form.credentialRef.trim() || null,
    role: form.role.trim(),
    environment: form.environment.trim() || "production",
    accessUrl: form.accessUrl.trim() || null,
    tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    maintenance: form.maintenance,
    healthChecks
  };
}

async function saveServer(): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  try {
    const payload = serverPayload();
    const result = editingId.value ? await api.updateServer(editingId.value, payload) : await api.createServer(payload);
    showEditor.value = false;
    notify(editingId.value ? "VPS 已更新" : "VPS 已添加");
    await refresh(result.server.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存失败";
  } finally {
    isSaving.value = false;
  }
}

async function probe(server: ServerRecord): Promise<void> {
  isProbing.value = server.id;
  errorMessage.value = null;
  try {
    await api.probeServer(server.id);
    await refresh(server.id);
    notify(`${server.name} 测活完成`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "测活失败";
  } finally {
    isProbing.value = null;
  }
}

async function archive(server: ServerRecord): Promise<void> {
  if (!window.confirm(`归档 ${server.name}？历史健康记录和审计记录会保留。`)) return;
  try {
    await api.archiveServer(server.id);
    selected.value = null;
    await refresh();
    notify(`${server.name} 已归档`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "归档失败";
  }
}

function resetProjectForm(): void {
  Object.assign(projectForm, {
    name: "",
    description: "",
    repositoryUrl: "",
    repositoryPath: "",
    runbook: emptyRunbook(),
    servers: [],
    services: []
  });
}

function openCreateProject(): void {
  resetProjectForm();
  editingProjectId.value = null;
  showProjectEditor.value = true;
}

function openEditProject(project: ProjectDetail): void {
  Object.assign(projectForm, {
    name: project.name,
    description: project.description,
    repositoryUrl: project.repositoryUrl ?? "",
    repositoryPath: project.repositoryPath ?? "",
    runbook: { ...project.runbook },
    servers: project.servers.map((server) => ({ serverId: server.serverId, role: server.role })),
    services: project.services.map((service) => ({
      serverId: service.serverId,
      name: service.name,
      manager: service.manager,
      identifier: service.identifier,
      port: service.port === null ? "" : String(service.port),
      accessUrl: service.accessUrl ?? "",
      critical: service.critical,
      notes: service.notes
    }))
  });
  editingProjectId.value = project.id;
  showProjectEditor.value = true;
}

function toggleProjectServer(serverId: string): void {
  const index = projectForm.servers.findIndex((server) => server.serverId === serverId);
  if (index === -1) {
    projectForm.servers.push({ serverId, role: "primary" });
    return;
  }
  projectForm.servers.splice(index, 1);
  projectForm.services = projectForm.services.filter((service) => service.serverId !== serverId);
}

function hasProjectServer(serverId: string): boolean {
  return projectForm.servers.some((server) => server.serverId === serverId);
}

function serverNameById(serverId: string): string {
  return dashboard.value?.servers.find((server) => server.id === serverId)?.name ?? "未找到 VPS";
}

function openLinkedServer(serverId: string): void {
  const server = dashboard.value?.servers.find((item) => item.id === serverId);
  if (server) void openServer(server);
}

function addProjectService(): void {
  const firstServer = projectForm.servers[0]?.serverId ?? "";
  if (!firstServer) {
    errorMessage.value = "请先关联至少一台 VPS";
    return;
  }
  projectForm.services.push({
    serverId: firstServer,
    name: "",
    manager: "docker",
    identifier: "",
    port: "",
    accessUrl: "",
    critical: false,
    notes: ""
  });
}

function removeProjectService(index: number): void {
  projectForm.services.splice(index, 1);
}

function projectPayload(): ProjectPayload {
  return {
    name: projectForm.name.trim(),
    description: projectForm.description.trim(),
    repositoryUrl: projectForm.repositoryUrl.trim() || null,
    repositoryPath: projectForm.repositoryPath.trim() || null,
    runbook: { ...projectForm.runbook },
    servers: projectForm.servers.map((server) => ({ serverId: server.serverId, role: server.role.trim() })),
    services: projectForm.services.map((service) => {
      const port = Number(service.port);
      return {
        serverId: service.serverId,
        name: service.name.trim(),
        manager: service.manager,
        identifier: service.identifier.trim(),
        port: Number.isInteger(port) && port > 0 ? port : null,
        accessUrl: service.accessUrl.trim() || null,
        critical: service.critical,
        notes: service.notes.trim()
      };
    })
  };
}

async function saveProject(): Promise<void> {
  isProjectSaving.value = true;
  errorMessage.value = null;
  const wasEditing = editingProjectId.value !== null;
  try {
    const payload = projectPayload();
    const result = editingProjectId.value
      ? await api.updateProject(editingProjectId.value, payload)
      : await api.createProject(payload);
    showProjectEditor.value = false;
    editingProjectId.value = null;
    notify(wasEditing ? "项目已更新" : "项目已创建");
    await refresh();
    selectedProject.value = result.project;
    activeView.value = "projects";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "保存项目失败";
  } finally {
    isProjectSaving.value = false;
  }
}

async function archiveProject(project: ProjectDetail): Promise<void> {
  if (!window.confirm(`归档项目 ${project.name}？项目记录和 Runbook 会保留。`)) return;
  try {
    await api.archiveProject(project.id);
    selectedProject.value = null;
    await refresh();
    notify(`${project.name} 已归档`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "归档项目失败";
  }
}

async function openAllVpsSync(): Promise<void> {
  isSyncing.value = true;
  errorMessage.value = null;
  try {
    syncPreview.value = await api.previewAllVpsSync();
    showSyncDialog.value = true;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法预览 all-vps 清单";
  } finally {
    isSyncing.value = false;
  }
}

async function applyAllVpsSync(): Promise<void> {
  if (!syncPreview.value) return;
  isSyncing.value = true;
  errorMessage.value = null;
  try {
    const result = await api.syncAllVps(syncPreview.value.source.digest);
    showSyncDialog.value = false;
    syncPreview.value = null;
    await refresh();
    notify(`all-vps 已同步：新增 ${result.summary.created}，更新 ${result.summary.updated}`);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "同步 all-vps 清单失败";
  } finally {
    isSyncing.value = false;
  }
}

onMounted(() => void refresh());
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark"><Network :size="20" /></div>
        <div>
          <strong>AI VPS Gateway</strong>
          <span>Local control plane</span>
        </div>
      </div>

      <nav class="nav-list" aria-label="主导航">
        <button :class="['nav-item', { active: activeView === 'overview' }]" @click="activeView = 'overview'">
          <LayoutDashboard :size="18" /> 概览
        </button>
        <button :class="['nav-item', { active: activeView === 'servers' }]" @click="activeView = 'servers'">
          <Server :size="18" /> VPS
          <span class="nav-count">{{ dashboard?.summary.total ?? 0 }}</span>
        </button>
        <button :class="['nav-item', { active: activeView === 'projects' }]" @click="activeView = 'projects'">
          <FolderKanban :size="18" /> 项目
          <span class="nav-count">{{ projects.length }}</span>
        </button>
        <button :class="['nav-item', { active: activeView === 'audit' }]" @click="activeView = 'audit'">
          <ShieldCheck :size="18" /> 审计
        </button>
      </nav>

      <div class="sidebar-foot">
        <div class="local-indicator"><span></span> 仅本机访问</div>
        <p>MCP 本机执行模式</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ activeView === 'overview' ? '资产状态' : activeView === 'servers' ? 'VPS 清单' : activeView === 'audit' ? '操作审计' : '项目档案' }}</p>
          <h1>{{ activeView === 'overview' ? '服务器概览' : activeView === 'servers' ? 'VPS 管理' : activeView === 'audit' ? '审计记录' : '项目管理' }}</h1>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" title="预览 all-vps 同步" :disabled="isSyncing" @click="openAllVpsSync"><FolderSync :size="18" :class="{ spinning: isSyncing }" /></button>
          <button class="icon-button" title="刷新数据" :disabled="isLoading" @click="refresh()"><RefreshCw :size="18" :class="{ spinning: isLoading }" /></button>
          <button class="primary-button" @click="activeView === 'projects' ? openCreateProject() : openCreate()"><Plus :size="18" /> {{ activeView === 'projects' ? '添加项目' : '添加 VPS' }}</button>
        </div>
      </header>

      <div v-if="errorMessage" class="error-banner"><CircleAlert :size="18" /> <span>{{ errorMessage }}</span><button title="关闭" @click="errorMessage = null"><X :size="16" /></button></div>
      <div v-if="notice" class="notice"><CircleCheckBig :size="18" /> {{ notice }}</div>

      <section v-if="activeView === 'overview'" class="content-area">
        <div class="stat-grid">
          <article class="stat-card total"><span>已登记 VPS</span><strong>{{ dashboard?.summary.total ?? 0 }}</strong><Server :size="21" /></article>
          <article class="stat-card healthy"><span>健康</span><strong>{{ dashboard?.summary.healthy ?? 0 }}</strong><Activity :size="21" /></article>
          <article class="stat-card degraded"><span>需处理</span><strong>{{ (dashboard?.summary.degraded ?? 0) + (dashboard?.summary.unreachable ?? 0) }}</strong><BellRing :size="21" /></article>
          <article class="stat-card unknown"><span>待测活</span><strong>{{ dashboard?.summary.unknown ?? 0 }}</strong><Clock3 :size="21" /></article>
        </div>

        <section class="panel fleet-panel">
          <div class="panel-heading">
            <div><h2>服务器状态</h2><p>最近更新 {{ relativeTime(dashboard?.summary.lastUpdatedAt ?? null) }}</p></div>
            <button class="text-button" @click="activeView = 'servers'">查看全部 <ArrowUpRight :size="15" /></button>
          </div>
          <div v-if="isLoading" class="loading-state">正在读取本机资产数据</div>
          <div v-else-if="!dashboard?.servers.length" class="empty-state"><Server :size="30" /><strong>还没有登记 VPS</strong><button class="primary-button" @click="openCreate"><Plus :size="17" /> 添加第一台</button></div>
          <button v-for="server in dashboard?.servers.slice(0, 6)" :key="server.id" class="server-row" @click="openServer(server)">
            <span :class="['status-dot', statusOf(server.status).tone]"></span>
            <span class="server-name"><strong>{{ server.name }}</strong><small>{{ server.address }}:{{ server.sshPort }}</small></span>
            <span class="server-role">{{ server.role || '未分类' }}</span>
            <span :class="['status-badge', statusOf(server.status).tone]">{{ statusOf(server.status).label }}</span>
            <span class="row-time">{{ relativeTime(server.lastCheckedAt) }}</span>
          </button>
        </section>

        <section class="panel signal-panel">
          <div class="panel-heading"><div><h2>测活判定</h2><p>ICMP 不是状态前提</p></div><Gauge :size="20" /></div>
          <div class="signal-flow"><span>TCP 端口</span><i></i><span>SSH Banner</span><i></i><span>项目 HTTP/TCP</span></div>
        </section>
      </section>

      <section v-else-if="activeView === 'servers'" class="content-area servers-view">
        <div v-if="selectedServer" class="detail-toolbar"><button class="back-button" @click="selected = null"><ChevronLeft :size="17" /> VPS 清单</button></div>
        <template v-if="selectedServer">
          <section class="detail-header">
            <div><div class="server-title"><span :class="['status-dot', statusOf(selectedServer.status).tone]"></span><h2>{{ selectedServer.name }}</h2><span :class="['status-badge', statusOf(selectedServer.status).tone]">{{ statusOf(selectedServer.status).label }}</span></div><p>{{ selectedServer.sshUser }}@{{ selectedServer.address }}:{{ selectedServer.sshPort }} <span v-if="selectedServer.role">· {{ selectedServer.role }}</span></p></div>
            <div class="detail-actions"><a v-if="selectedServer.accessUrl" class="icon-button link-button" :href="selectedServer.accessUrl" target="_blank" rel="noreferrer" title="打开访问地址"><Globe2 :size="18" /></a><button class="icon-button" title="立即测活" :disabled="isProbing === selectedServer.id" @click="probe(selectedServer)"><RefreshCw :size="18" :class="{ spinning: isProbing === selectedServer.id }" /></button><button v-if="selectedServer.sshUser === 'root' && !emergencyRootActive(selectedServer)" class="danger-button" :disabled="isRootAction" @click="grantEmergencyRoot(selectedServer)"><ShieldCheck :size="16" /> 开启紧急 root</button><button v-else-if="!selectedServerSession" class="secondary-button" :disabled="isSessionAction" @click="openAiSession(selectedServer)"><ShieldCheck :size="16" /> 开启会话</button><button v-else class="secondary-button" :disabled="isSessionAction" @click="closeAiSession"><X :size="16" /> 释放会话</button><button v-if="selectedServer.sshUser === 'root' && emergencyRootActive(selectedServer)" class="icon-button" title="关闭紧急 root 救援" :disabled="isRootAction" @click="revokeEmergencyRoot(selectedServer)"><ShieldCheck :size="17" /></button><button class="secondary-button" @click="openEdit(selectedServer)">编辑</button><button class="danger-button" @click="archive(selectedServer)"><Archive :size="16" /> 归档</button></div>
          </section>
          <div class="detail-grid">
            <section class="panel health-panel"><div class="panel-heading"><div><h2>健康检查</h2><p>{{ humanTime(selectedServer.lastCheckedAt) }}</p></div><Activity :size="20" /></div><div v-if="selected?.events.length" class="probe-list"><div v-for="result in selected.events[0].results" :key="`${selected.events[0].id}-${result.name}`" class="probe-item"><span :class="['status-dot', result.ok ? 'healthy' : 'offline']"></span><span><strong>{{ result.name }}</strong><small>{{ result.detail }}</small></span><em>{{ result.latencyMs }} ms</em></div></div><div v-else class="empty-inline">尚无测活记录</div></section>
            <section class="panel metrics-panel"><div class="panel-heading"><div><h2>性能</h2><p>{{ selected?.metric ? humanTime(selected.metric.collectedAt) : '尚未采集' }}</p></div><div class="panel-heading-actions"><button class="mini-icon" title="采集当前性能" :disabled="isCollectingMetrics" @click="collectMetrics(selectedServer)"><RefreshCw :size="15" :class="{ spinning: isCollectingMetrics }" /></button><Gauge :size="20" /></div></div><div v-if="selected?.metric" class="metric-grid"><div><span>CPU</span><strong>{{ selected.metric.cpuPercent ?? '—' }}<small v-if="selected.metric.cpuPercent !== null">%</small></strong></div><div><span>内存</span><strong>{{ selected.metric.memoryPercent ?? '—' }}<small v-if="selected.metric.memoryPercent !== null">%</small></strong></div><div><span>磁盘</span><strong>{{ selected.metric.diskPercent ?? '—' }}<small v-if="selected.metric.diskPercent !== null">%</small></strong></div><div><span>Load 1m</span><strong>{{ selected.metric.load1 ?? '—' }}</strong></div></div><div v-if="selected?.metric?.note" class="metric-note"><CircleAlert :size="15" /> {{ selected.metric.note }}</div><div v-else-if="!selected?.metric" class="empty-inline">采集的是当前快照，不安装 Agent，也不会读取当前目录中的私钥。</div></section>
            <section class="panel session-panel"><div class="panel-heading"><div><h2>AI 会话租约</h2><p>同一 VPS 同时只允许一个执行会话</p></div><ShieldCheck :size="20" /></div><div v-if="selectedServerSession" class="session-summary"><div class="session-summary-top"><span :class="['status-badge', sessionStatusOf(selectedServerSession.status).tone]">{{ sessionStatusOf(selectedServerSession.status).label }}</span><strong>{{ selectedServerSession.requester }}</strong><small v-if="selectedServerSession.status === 'queued'">排队第 {{ selectedServerSession.queuePosition }} 位</small></div><dl class="property-list"><div><dt>空闲释放</dt><dd>{{ selectedServerSession.idleExpiresAt ? humanTime(selectedServerSession.idleExpiresAt) : '获得租约后开始' }}</dd></div><div><dt>最长租期</dt><dd>{{ humanTime(selectedServerSession.maxExpiresAt) }}</dd></div><div><dt>会话 ID</dt><dd class="mono-value">{{ selectedServerSession.id }}</dd></div></dl><div v-if="selectedSession?.commands.length" class="session-command-list"><div v-for="command in selectedSession.commands.slice(0, 5)" :key="command.id"><span :class="['risk-label', command.risk]">{{ commandRiskLabel(command.risk) }}</span><code>{{ command.command }}</code><small>{{ commandOutcomeLabel(command.outcome) }} · {{ humanTime(command.createdAt) }}</small></div></div></div><div v-else class="empty-inline">当前没有占用或排队中的 AI 会话</div></section>
            <section class="panel inventory-panel"><div class="panel-heading"><div><h2>连接资料</h2><p>仅保存引用，不保存秘密</p></div><Terminal :size="20" /></div><dl class="property-list"><div><dt>环境</dt><dd>{{ selectedServer.environment }}</dd></div><div><dt>数据来源</dt><dd>{{ selectedServer.source === 'all-vps' ? 'all-vps 文档同步' : '手动登记' }}</dd></div><div><dt>凭据引用</dt><dd>{{ selectedServer.credentialRef ?? '未关联' }}</dd></div><div v-if="selectedServer.sshUser === 'root'"><dt>root 救援</dt><dd :class="emergencyRootActive(selectedServer) ? 'root-grant-active' : 'root-grant-missing'">{{ emergencyRootActive(selectedServer) ? `有效至 ${humanTime(selectedServer.emergencyRootUntil)}` : '未开启，需 WebUI 显式开启' }}</dd></div><div><dt>标签</dt><dd><span v-if="selectedServer.tags.length" class="tag-list"><b v-for="tag in selectedServer.tags" :key="tag">{{ tag }}</b></span><span v-else>无</span></dd></div><div><dt>维护状态</dt><dd>{{ selectedServer.maintenance ? '已开启' : '正常' }}</dd></div></dl></section>
            <section class="panel history-panel"><div class="panel-heading"><div><h2>健康历史</h2><p>最近 {{ selected?.events.length ?? 0 }} 次</p></div><Clock3 :size="20" /></div><div v-if="selected?.events.length" class="timeline"><div v-for="event in selected.events.slice(0, 8)" :key="event.id"><span :class="['status-dot', statusOf(event.status).tone]"></span><strong>{{ statusOf(event.status).label }}</strong><time>{{ humanTime(event.checkedAt) }}</time><p v-if="event.error">{{ event.error }}</p></div></div><div v-else class="empty-inline">尚无健康历史</div></section>
          </div>
        </template>
        <template v-else>
          <div class="list-controls"><label class="search-input"><Network :size="17" /><input v-model="query" type="search" placeholder="搜索名称、地址、标签" /></label><span>{{ visibleServers.length }} 台 VPS</span></div>
          <section class="panel table-panel"><div v-if="isLoading" class="loading-state">正在读取 VPS</div><div v-else-if="!visibleServers.length" class="empty-state"><Server :size="30" /><strong>{{ dashboard?.servers.length ? '没有匹配的 VPS' : '还没有登记 VPS' }}</strong><button v-if="!dashboard?.servers.length" class="primary-button" @click="openCreate"><Plus :size="17" /> 添加 VPS</button></div><div v-else class="server-table"><div class="table-head"><span>名称</span><span>地址</span><span>用途</span><span>状态</span><span>检查时间</span><span></span></div><button v-for="server in visibleServers" :key="server.id" class="table-row" @click="openServer(server)"><span class="name-cell"><span :class="['status-dot', statusOf(server.status).tone]"></span><strong>{{ server.name }}</strong><small>{{ server.environment }}<span v-if="server.source === 'all-vps'"> · 文档同步</span></small></span><span class="address-cell">{{ server.address }}<small>{{ server.sshUser }} · :{{ server.sshPort }}</small></span><span>{{ server.role || '—' }}</span><span :class="['status-badge', statusOf(server.status).tone]">{{ statusOf(server.status).label }}</span><span class="row-time">{{ humanTime(server.lastCheckedAt) }}</span><span class="row-action"><button class="mini-icon" title="立即测活" :disabled="isProbing === server.id" @click.stop="probe(server)"><RefreshCw :size="15" :class="{ spinning: isProbing === server.id }" /></button></span></button></div></section>
        </template>
      </section>

      <section v-else-if="activeView === 'audit'" class="content-area"><section class="panel audit-panel"><div class="panel-heading"><div><h2>本机审计</h2><p>会话、命令、阻断和资产操作均保留记录</p></div><ShieldCheck :size="20" /></div><div v-if="!auditEvents.length" class="empty-inline">还没有审计事件</div><div v-else class="audit-list"><div v-for="event in auditEvents" :key="event.id"><span :class="['audit-mark', event.severity]"></span><div><strong>{{ event.summary }}</strong><small>{{ event.action }} · {{ humanTime(event.createdAt) }}<span v-if="event.severity !== 'info'"> · {{ event.severity === 'critical' ? '需要立即关注' : '高危操作提示' }}</span></small></div></div></div></section></section>

      <section v-else-if="activeView === 'projects'" class="content-area projects-view">
        <div v-if="selectedProject" class="detail-toolbar"><button class="back-button" @click="selectedProject = null"><ChevronLeft :size="17" /> 项目清单</button></div>
        <template v-if="selectedProject">
          <section class="project-detail-header">
            <div><div class="server-title"><FolderKanban :size="20" /><h2>{{ selectedProject.name }}</h2></div><p>{{ selectedProject.description || '暂无项目描述' }}</p><div class="project-links"><a v-if="selectedProject.repositoryUrl" :href="selectedProject.repositoryUrl" target="_blank" rel="noreferrer">代码仓库 <ArrowUpRight :size="14" /></a><span v-if="selectedProject.repositoryPath">{{ selectedProject.repositoryPath }}</span></div></div>
            <div class="detail-actions"><button class="secondary-button" @click="openEditProject(selectedProject)">编辑档案</button><button class="danger-button" @click="archiveProject(selectedProject)"><Archive :size="16" /> 归档</button></div>
          </section>
          <div class="project-detail-grid">
            <section class="panel runbook-panel"><div class="panel-heading"><div><h2>运维 Runbook</h2><p>给后续 AI 会话和人工排错使用</p></div><ShieldCheck :size="20" /></div><div class="runbook-sections"><article v-for="section in runbookSections" :key="section.key"><h3>{{ section.label }}</h3><p v-if="selectedProject.runbook[section.key]" class="runbook-text">{{ selectedProject.runbook[section.key] }}</p><p v-else class="empty-inline">尚未填写</p></article></div></section>
            <section class="panel project-assets-panel"><div class="panel-heading"><div><h2>关联 VPS</h2><p>{{ selectedProject.servers.length }} 台</p></div><Server :size="20" /></div><div v-if="selectedProject.servers.length" class="project-server-list"><button v-for="server in selectedProject.servers" :key="server.serverId" class="project-server-row" @click="openLinkedServer(server.serverId)"><span :class="['status-dot', statusOf(server.status).tone]"></span><span><strong>{{ server.serverName }}</strong><small>{{ server.role || '未定义角色' }} · {{ server.address }}:{{ server.sshPort }}</small></span><ArrowUpRight :size="15" /></button></div><div v-else class="empty-inline">尚未关联 VPS</div></section>
            <section class="panel project-services-panel"><div class="panel-heading"><div><h2>服务清单</h2><p>{{ selectedProject.services.length }} 项，其中关键 {{ selectedProject.criticalServiceCount }} 项</p></div><Terminal :size="20" /></div><div v-if="selectedProject.services.length" class="project-service-list"><div v-for="service in selectedProject.services" :key="service.id" class="project-service-row"><div class="service-row-main"><strong>{{ service.name }}</strong><span v-if="service.critical" class="critical-label">关键</span><small>{{ service.serverName }} · {{ managerLabels[service.manager] }} · {{ service.identifier }}<span v-if="service.port"> · :{{ service.port }}</span></small></div><a v-if="service.accessUrl" :href="service.accessUrl" target="_blank" rel="noreferrer" class="mini-link" title="打开访问地址"><Globe2 :size="16" /></a><p v-if="service.notes">{{ service.notes }}</p></div></div><div v-else class="empty-inline">尚未登记 Docker、systemd 或其他服务</div></section>
          </div>
        </template>
        <template v-else>
          <div class="list-controls"><label class="search-input"><FolderKanban :size="17" /><input v-model="projectQuery" type="search" placeholder="搜索项目、描述、仓库" /></label><span>{{ visibleProjects.length }} 个项目</span></div>
          <section class="panel project-list-panel"><div v-if="isLoading" class="loading-state">正在读取项目档案</div><div v-else-if="!visibleProjects.length" class="empty-state"><FolderKanban :size="30" /><strong>{{ projects.length ? '没有匹配的项目' : '还没有项目档案' }}</strong><button class="primary-button" @click="openCreateProject"><Plus :size="17" /> 添加项目</button></div><div v-else class="project-list"><button v-for="project in visibleProjects" :key="project.id" class="project-row" @click="openProject(project)"><span class="project-row-main"><strong>{{ project.name }}</strong><small>{{ project.description || '暂无描述' }}</small></span><span>{{ project.serverCount }} 台 VPS</span><span>{{ project.serviceCount }} 项服务</span><span v-if="project.criticalServiceCount" class="critical-label">关键 {{ project.criticalServiceCount }}</span><ArrowUpRight :size="16" /></button></div></section>
        </template>
      </section>
    </main>

    <div v-if="showEditor" class="modal-backdrop" @mousedown.self="showEditor = false">
      <form class="editor-modal" @submit.prevent="saveServer">
        <header><div><p class="eyebrow">{{ isEditing ? '编辑资产' : '手动登记' }}</p><h2>{{ isEditing ? '更新 VPS' : '添加 VPS' }}</h2></div><button class="icon-button" type="button" title="关闭" @click="showEditor = false"><X :size="18" /></button></header>
        <div class="form-grid"><label class="full"><span>显示名称</span><input v-model="form.name" required maxlength="80" placeholder="例如：大阪主站" /></label><label><span>地址</span><input v-model="form.address" required maxlength="253" placeholder="IP 或主机名" /></label><label><span>SSH 端口</span><input v-model.number="form.sshPort" required type="number" min="1" max="65535" /></label><label><span>SSH 用户</span><input v-model="form.sshUser" required maxlength="80" placeholder="ubuntu" /></label><label><span>环境</span><input v-model="form.environment" required maxlength="40" placeholder="production" /></label><label class="full"><span>用途 / 角色</span><input v-model="form.role" maxlength="100" placeholder="例如：Web、数据库、代理节点" /></label><label class="full"><span>访问地址</span><input v-model="form.accessUrl" type="url" placeholder="https://example.com" /></label><label><span>凭据引用</span><input v-model="form.credentialRef" maxlength="160" placeholder="仅名称，不输入路径或私钥" /></label><label><span>标签</span><input v-model="form.tags" maxlength="200" placeholder="逗号分隔，例如：docker, asia" /></label></div>
        <label class="switch-row"><input v-model="form.addHttpCheck" type="checkbox" /><span><strong>附加 HTTP 健康检查</strong><small>按指定状态码判断，不将 Ping 作为前提。</small></span></label>
        <div v-if="form.addHttpCheck" class="form-grid check-fields"><label class="full"><span>健康检查 URL</span><input v-model="form.healthUrl" required type="url" placeholder="https://example.com/health" /></label><label class="full"><span>预期状态码</span><input v-model="form.expectedStatusCodes" required placeholder="200, 301, 404" /></label></div>
        <label class="switch-row"><input v-model="form.maintenance" type="checkbox" /><span><strong>维护模式</strong><small>保留资产，但探针显示为维护中。</small></span></label>
        <footer><button class="secondary-button" type="button" @click="showEditor = false">取消</button><button class="primary-button" :disabled="isSaving" type="submit"><RefreshCw v-if="isSaving" :size="17" class="spinning" /><Plus v-else :size="17" />{{ isSaving ? '保存中' : isEditing ? '保存更改' : '添加 VPS' }}</button></footer>
      </form>
    </div>

    <div v-if="showSyncDialog && syncPreview" class="modal-backdrop" @mousedown.self="showSyncDialog = false">
      <section class="sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <header><div><p class="eyebrow">本机清单</p><h2 id="sync-title">同步 all-vps</h2></div><button class="icon-button" type="button" title="关闭" :disabled="isSyncing" @click="showSyncDialog = false"><X :size="18" /></button></header>
        <div class="sync-summary"><strong>{{ syncPreview.changes.length }} 台资产</strong><span>新增 {{ syncPreview.summary.created }}</span><span>更新 {{ syncPreview.summary.updated }}</span><span>无变更 {{ syncPreview.summary.unchanged }}</span></div>
        <div v-if="syncPreview.warnings.length" class="sync-warnings"><p v-for="warning in syncPreview.warnings" :key="warning"><CircleAlert :size="15" /> {{ warning }}</p></div>
        <div class="sync-change-list"><div v-for="change in syncPreview.changes" :key="change.sourceKey"><span :class="['sync-action', change.action]">{{ syncActionLabel(change.action) }}</span><div><strong>{{ change.name }}</strong><small>{{ change.changes.length ? change.changes.join('、') : '与文档一致' }}</small></div></div></div>
        <div v-if="syncPreview.stale.length" class="sync-stale"><strong>文档中已不存在的已导入资产不会自动归档</strong><span>{{ syncPreview.stale.map((server) => server.name).join('、') }}</span></div>
        <footer><button class="secondary-button" type="button" :disabled="isSyncing" @click="showSyncDialog = false">取消</button><button class="primary-button" type="button" :disabled="isSyncing" @click="applyAllVpsSync"><RefreshCw :size="17" :class="{ spinning: isSyncing }" />{{ isSyncing ? '同步中' : '应用同步' }}</button></footer>
      </section>
    </div>

    <div v-if="showProjectEditor" class="modal-backdrop" @mousedown.self="showProjectEditor = false">
      <form class="editor-modal project-editor-modal" @submit.prevent="saveProject">
        <header><div><p class="eyebrow">项目档案</p><h2>{{ isProjectEditing ? '编辑项目' : '创建项目' }}</h2></div><button class="icon-button" type="button" title="关闭" @click="showProjectEditor = false"><X :size="18" /></button></header>
        <div class="form-grid"><label class="full"><span>项目名称</span><input v-model="projectForm.name" required maxlength="100" placeholder="例如：竞赛文件平台" /></label><label class="full"><span>项目描述</span><input v-model="projectForm.description" maxlength="2_000" placeholder="一句话说明项目用途和当前状态" /></label><label><span>代码仓库</span><input v-model="projectForm.repositoryUrl" type="url" placeholder="https://github.com/..." /></label><label><span>本机项目路径</span><input v-model="projectForm.repositoryPath" maxlength="320" placeholder="仅保存路径引用" /></label></div>
        <section class="modal-section"><div class="modal-section-heading"><div><h3>关联 VPS</h3><p>先选中项目涉及的服务器，再登记服务。</p></div><span>{{ projectForm.servers.length }} 台</span></div><div class="server-picker"><label v-for="server in dashboard?.servers ?? []" :key="server.id" class="server-picker-row"><input type="checkbox" :checked="hasProjectServer(server.id)" @change="toggleProjectServer(server.id)" /><span><strong>{{ server.name }}</strong><small>{{ server.address }}:{{ server.sshPort }}</small></span></label></div><div v-if="projectForm.servers.length" class="server-role-list"><label v-for="server in projectForm.servers" :key="server.serverId"><span>{{ serverNameById(server.serverId) }}</span><input v-model="server.role" maxlength="80" placeholder="角色，例如 primary / database" /></label></div></section>
        <section class="modal-section"><div class="modal-section-heading"><div><h3>服务清单</h3><p>记录容器名、systemd unit、端口和关键性。</p></div><button class="text-button" type="button" :disabled="!projectForm.servers.length" @click="addProjectService"><Plus :size="15" /> 添加服务</button></div><div v-if="projectForm.services.length" class="service-editor-list"><div v-for="(service, index) in projectForm.services" :key="index" class="service-editor-row"><div class="service-editor-grid"><label><span>所属 VPS</span><select v-model="service.serverId"><option v-for="server in projectForm.servers" :key="server.serverId" :value="server.serverId">{{ serverNameById(server.serverId) }}</option></select></label><label><span>服务名称</span><input v-model="service.name" required maxlength="100" placeholder="例如：Nginx" /></label><label><span>管理方式</span><select v-model="service.manager"><option value="docker">Docker</option><option value="systemd">systemd</option><option value="process">直接进程</option><option value="external">外部托管</option></select></label><label><span>标识</span><input v-model="service.identifier" required maxlength="160" placeholder="容器名或 unit 名" /></label><label><span>端口</span><input v-model="service.port" type="number" min="1" max="65535" placeholder="可选" /></label><label><span>访问地址</span><input v-model="service.accessUrl" type="url" placeholder="可选" /></label><label class="service-critical"><input v-model="service.critical" type="checkbox" /><span>关键服务</span></label><label class="full"><span>备注</span><input v-model="service.notes" maxlength="4_000" placeholder="依赖、日志位置或特殊注意事项" /></label></div><button class="mini-icon service-remove" type="button" title="移除服务" @click="removeProjectService(index)"><X :size="15" /></button></div></div><div v-else class="empty-inline">尚未登记服务</div></section>
        <section class="modal-section runbook-editor-section"><div class="modal-section-heading"><div><h3>运维 Runbook</h3><p>保存给后续 AI 会话使用的操作资料，不要写入密码、Token 或私钥。</p></div></div><div class="runbook-editor-grid"><label v-for="section in runbookSections" :key="section.key"><span>{{ section.label }}</span><textarea v-model="projectForm.runbook[section.key]" rows="5" maxlength="12_000" :placeholder="section.placeholder"></textarea></label></div></section>
        <footer><button class="secondary-button" type="button" :disabled="isProjectSaving" @click="showProjectEditor = false">取消</button><button class="primary-button" :disabled="isProjectSaving" type="submit"><RefreshCw v-if="isProjectSaving" :size="17" class="spinning" /><Plus v-else :size="17" />{{ isProjectSaving ? '保存中' : isProjectEditing ? '保存更改' : '创建项目' }}</button></footer>
      </form>
    </div>
  </div>
</template>
