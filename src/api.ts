import type {
  AllVpsSyncPreview,
  AllMetricsResponse,
  AlertResponse,
  AuditEvent,
  DashboardResponse,
  AllVpsProjectSyncResponse,
  MetricHistoryResponse,
  ProjectDetail,
  ProjectPayload,
  ProjectRecord,
  ServerDetail,
  ServerPayload,
  ServerRecord,
  SshBindingResponse,
  SessionDetail,
  SessionRecord,
  ServerProjectSyncResult
} from "./types";

interface ApiErrorPayload {
  message?: string;
}

const sessionCapabilities = new Map<string, string>();

function sessionHeaders(sessionId: string | undefined): Record<string, string> {
  const token = sessionId ? sessionCapabilities.get(sessionId) : undefined;
  return token ? { "x-ai-vps-session-token": token } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
    ...(init?.headers ?? {})
  };
  const response = await fetch(path, {
    ...init,
    headers
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new Error(payload.message ?? `请求失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

export const api = {
  dashboard: () => request<DashboardResponse>("/api/dashboard"),
  server: (id: string) => request<ServerDetail>(`/api/servers/${id}`),
  metricHistory: (id: string, limit = 48, hours = 24 * 7) => request<MetricHistoryResponse>(`/api/servers/${id}/metrics/history?limit=${limit}&hours=${hours}`),
  alerts: (limit = 30) => request<AlertResponse>(`/api/alerts?limit=${limit}`),
  audit: () => request<{ events: AuditEvent[] }>("/api/audit"),
  createServer: (payload: ServerPayload) => request<{ server: ServerRecord }>("/api/servers", { method: "POST", body: JSON.stringify(payload) }),
  updateServer: (id: string, payload: ServerPayload) =>
    request<{ server: ServerRecord }>(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  probeServer: (id: string) => request<{ server: ServerRecord }>(`/api/servers/${id}/probe`, { method: "POST" }),
  prepareSshBinding: (id: string) => request<SshBindingResponse>(`/api/servers/${id}/ssh/bootstrap`, { method: "POST" }),
  testSshBinding: (id: string) => request<SshBindingResponse>(`/api/servers/${id}/ssh/test`, { method: "POST" }),
  grantEmergencyRoot: (id: string, durationMs = 8 * 60 * 60_000) => request<{ server: ServerRecord }>(`/api/servers/${id}/emergency-root`, { method: "POST", body: JSON.stringify({ durationMs }) }),
  revokeEmergencyRoot: (id: string) => request<{ server: ServerRecord }>(`/api/servers/${id}/emergency-root/revoke`, { method: "POST" }),
  archiveServer: (id: string) => request<{ archived: boolean }>(`/api/servers/${id}/archive`, { method: "POST" }),
  deleteServer: (id: string) => request<{ deleted: true; serverId: string; credentialRemoved: boolean }>(`/api/servers/${id}/delete`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
  sessions: () => request<{ sessions: SessionRecord[] }>("/api/sessions"),
  openSession: async (serverId: string, requester = "webui"): Promise<{ session: SessionRecord }> => {
    const result = await request<{ session: SessionRecord; capabilityToken: string }>("/api/sessions", { method: "POST", body: JSON.stringify({ serverId, requester }) });
    sessionCapabilities.set(result.session.id, result.capabilityToken);
    return { session: result.session };
  },
  ownsSession: (id: string) => sessionCapabilities.has(id),
  session: (id: string) => request<{ session: SessionDetail }>(`/api/sessions/${id}`, { headers: sessionHeaders(id) }),
  runCommand: (id: string, command: string, timeoutMs?: number) => request<{ result: unknown; session: SessionDetail | null }>(`/api/sessions/${id}/commands`, { method: "POST", headers: sessionHeaders(id), body: JSON.stringify({ command, timeoutMs }) }),
  closeSession: async (id: string, reason = "closed_from_webui"): Promise<{ session: SessionRecord; promoted: SessionRecord | null }> => {
    const result = await request<{ session: SessionRecord; promoted: SessionRecord | null }>(`/api/sessions/${id}/close`, { method: "POST", headers: sessionHeaders(id), body: JSON.stringify({ reason }) });
    sessionCapabilities.delete(id);
    return result;
  },
  collectMetrics: (serverId: string, sessionId?: string) => request<{ metric: ServerDetail["metric"] }>(`/api/servers/${serverId}/metrics`, { method: "POST", headers: sessionHeaders(sessionId), body: JSON.stringify({ sessionId }) }),
  collectAllMetrics: () => request<AllMetricsResponse>("/api/metrics/all", { method: "POST" }),
  syncServerProjects: (serverId: string, sessionId?: string) => request<ServerProjectSyncResult>(`/api/servers/${serverId}/inventory/sync-projects`, { method: "POST", headers: sessionHeaders(sessionId), body: JSON.stringify({ sessionId }) }),
  syncAllVpsProjects: () => request<AllVpsProjectSyncResponse>("/api/inventory/all-vps/sync-projects", { method: "POST" }),
  projects: () => request<{ projects: ProjectRecord[] }>("/api/projects"),
  project: (id: string) => request<{ project: ProjectDetail }>(`/api/projects/${id}`),
  createProject: (payload: ProjectPayload) => request<{ project: ProjectDetail }>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: ProjectPayload) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  archiveProject: (id: string) => request<{ archived: boolean }>(`/api/projects/${id}/archive`, { method: "POST" }),
  deleteProject: (id: string, cleanupSummary: string) =>
    request<{ deleted: true; projectId: string; projectName: string }>(`/api/projects/${id}/delete`, {
      method: "POST",
      body: JSON.stringify({ cleanupConfirmed: true, cleanupSummary })
    }),
  previewAllVpsSync: () => request<AllVpsSyncPreview>("/api/sync/all-vps/preview"),
  syncAllVps: (sourceDigest: string) =>
    request<AllVpsSyncPreview>("/api/sync/all-vps", { method: "POST", body: JSON.stringify({ sourceDigest }) })
};
