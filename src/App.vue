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
import type { AuditEvent, DashboardResponse, ServerDetail, ServerPayload, ServerRecord, ServerStatus } from "./types";

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

const selectedServer = computed(() => selected.value?.server ?? null);
const isEditing = computed(() => editingId.value !== null);

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

async function refresh(selectId?: string): Promise<void> {
  isLoading.value = !dashboard.value;
  errorMessage.value = null;
  try {
    const [nextDashboard, nextAudit] = await Promise.all([api.dashboard(), api.audit()]);
    dashboard.value = nextDashboard;
    auditEvents.value = nextAudit.events;
    const targetId = selectId ?? selected.value?.server.id;
    if (targetId) selected.value = await api.server(targetId).catch(() => null);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法连接本机网关";
  } finally {
    isLoading.value = false;
  }
}

async function openServer(server: ServerRecord): Promise<void> {
  try {
    selected.value = await api.server(server.id);
    activeView.value = "servers";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取 VPS 详情失败";
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
          <span class="coming-soon">Soon</span>
        </button>
        <button :class="['nav-item', { active: activeView === 'audit' }]" @click="activeView = 'audit'">
          <ShieldCheck :size="18" /> 审计
        </button>
      </nav>

      <div class="sidebar-foot">
        <div class="local-indicator"><span></span> 仅本机访问</div>
        <p>MCP 0.1 只读模式</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ activeView === 'overview' ? '资产状态' : activeView === 'servers' ? 'VPS 清单' : activeView === 'audit' ? '操作审计' : '项目档案' }}</p>
          <h1>{{ activeView === 'overview' ? '服务器概览' : activeView === 'servers' ? 'VPS 管理' : activeView === 'audit' ? '审计记录' : '项目管理' }}</h1>
        </div>
        <div class="topbar-actions">
          <button class="icon-button" title="刷新数据" :disabled="isLoading" @click="refresh()"><RefreshCw :size="18" :class="{ spinning: isLoading }" /></button>
          <button class="primary-button" @click="openCreate"><Plus :size="18" /> 添加 VPS</button>
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
            <div class="detail-actions"><a v-if="selectedServer.accessUrl" class="icon-button link-button" :href="selectedServer.accessUrl" target="_blank" rel="noreferrer" title="打开访问地址"><Globe2 :size="18" /></a><button class="icon-button" title="立即测活" :disabled="isProbing === selectedServer.id" @click="probe(selectedServer)"><RefreshCw :size="18" :class="{ spinning: isProbing === selectedServer.id }" /></button><button class="secondary-button" @click="openEdit(selectedServer)">编辑</button><button class="danger-button" @click="archive(selectedServer)"><Archive :size="16" /> 归档</button></div>
          </section>
          <div class="detail-grid">
            <section class="panel health-panel"><div class="panel-heading"><div><h2>健康检查</h2><p>{{ humanTime(selectedServer.lastCheckedAt) }}</p></div><Activity :size="20" /></div><div v-if="selected?.events.length" class="probe-list"><div v-for="result in selected.events[0].results" :key="`${selected.events[0].id}-${result.name}`" class="probe-item"><span :class="['status-dot', result.ok ? 'healthy' : 'offline']"></span><span><strong>{{ result.name }}</strong><small>{{ result.detail }}</small></span><em>{{ result.latencyMs }} ms</em></div></div><div v-else class="empty-inline">尚无测活记录</div></section>
            <section class="panel metrics-panel"><div class="panel-heading"><div><h2>性能</h2><p>{{ selected?.metric ? humanTime(selected.metric.collectedAt) : '等待 SSH 凭据层' }}</p></div><Gauge :size="20" /></div><div v-if="selected?.metric" class="metric-grid"><div><span>CPU</span><strong>{{ selected.metric.cpuPercent ?? '—' }}<small v-if="selected.metric.cpuPercent !== null">%</small></strong></div><div><span>内存</span><strong>{{ selected.metric.memoryPercent ?? '—' }}<small v-if="selected.metric.memoryPercent !== null">%</small></strong></div><div><span>磁盘</span><strong>{{ selected.metric.diskPercent ?? '—' }}<small v-if="selected.metric.diskPercent !== null">%</small></strong></div><div><span>Load 1m</span><strong>{{ selected.metric.load1 ?? '—' }}</strong></div></div><div v-else class="empty-inline">凭据隔离层接入后开始采集，不会读取当前目录中的私钥。</div></section>
            <section class="panel inventory-panel"><div class="panel-heading"><div><h2>连接资料</h2><p>仅保存引用，不保存秘密</p></div><Terminal :size="20" /></div><dl class="property-list"><div><dt>环境</dt><dd>{{ selectedServer.environment }}</dd></div><div><dt>凭据引用</dt><dd>{{ selectedServer.credentialRef ?? '未关联' }}</dd></div><div><dt>标签</dt><dd><span v-if="selectedServer.tags.length" class="tag-list"><b v-for="tag in selectedServer.tags" :key="tag">{{ tag }}</b></span><span v-else>无</span></dd></div><div><dt>维护状态</dt><dd>{{ selectedServer.maintenance ? '已开启' : '正常' }}</dd></div></dl></section>
            <section class="panel history-panel"><div class="panel-heading"><div><h2>健康历史</h2><p>最近 {{ selected?.events.length ?? 0 }} 次</p></div><Clock3 :size="20" /></div><div v-if="selected?.events.length" class="timeline"><div v-for="event in selected.events.slice(0, 8)" :key="event.id"><span :class="['status-dot', statusOf(event.status).tone]"></span><strong>{{ statusOf(event.status).label }}</strong><time>{{ humanTime(event.checkedAt) }}</time><p v-if="event.error">{{ event.error }}</p></div></div><div v-else class="empty-inline">尚无健康历史</div></section>
          </div>
        </template>
        <template v-else>
          <div class="list-controls"><label class="search-input"><Network :size="17" /><input v-model="query" type="search" placeholder="搜索名称、地址、标签" /></label><span>{{ visibleServers.length }} 台 VPS</span></div>
          <section class="panel table-panel"><div v-if="isLoading" class="loading-state">正在读取 VPS</div><div v-else-if="!visibleServers.length" class="empty-state"><Server :size="30" /><strong>{{ dashboard?.servers.length ? '没有匹配的 VPS' : '还没有登记 VPS' }}</strong><button v-if="!dashboard?.servers.length" class="primary-button" @click="openCreate"><Plus :size="17" /> 添加 VPS</button></div><div v-else class="server-table"><div class="table-head"><span>名称</span><span>地址</span><span>用途</span><span>状态</span><span>检查时间</span><span></span></div><button v-for="server in visibleServers" :key="server.id" class="table-row" @click="openServer(server)"><span class="name-cell"><span :class="['status-dot', statusOf(server.status).tone]"></span><strong>{{ server.name }}</strong><small>{{ server.environment }}</small></span><span class="address-cell">{{ server.address }}<small>{{ server.sshUser }} · :{{ server.sshPort }}</small></span><span>{{ server.role || '—' }}</span><span :class="['status-badge', statusOf(server.status).tone]">{{ statusOf(server.status).label }}</span><span class="row-time">{{ humanTime(server.lastCheckedAt) }}</span><span class="row-action"><button class="mini-icon" title="立即测活" :disabled="isProbing === server.id" @click.stop="probe(server)"><RefreshCw :size="15" :class="{ spinning: isProbing === server.id }" /></button></span></button></div></section>
        </template>
      </section>

      <section v-else-if="activeView === 'audit'" class="content-area"><section class="panel audit-panel"><div class="panel-heading"><div><h2>本机审计</h2><p>资产与测活操作均保留记录</p></div><ShieldCheck :size="20" /></div><div v-if="!auditEvents.length" class="empty-inline">还没有审计事件</div><div v-else class="audit-list"><div v-for="event in auditEvents" :key="event.id"><span :class="['audit-mark', event.severity]"></span><div><strong>{{ event.summary }}</strong><small>{{ event.action }} · {{ humanTime(event.createdAt) }}</small></div></div></div></section></section>

      <section v-else class="content-area"><section class="panel future-panel"><FolderKanban :size="30" /><h2>项目档案即将接入</h2><p>下一阶段会在这里管理 Runbook、部署记录、服务依赖和故障经验。</p></section></section>
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
  </div>
</template>
