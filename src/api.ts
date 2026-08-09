import type {
  AllVpsSyncPreview,
  AuditEvent,
  DashboardResponse,
  ProjectDetail,
  ProjectPayload,
  ProjectRecord,
  ServerDetail,
  ServerPayload,
  ServerRecord,
  SessionDetail,
  SessionRecord
} from "./types";

interface ApiErrorPayload {
  message?: string;
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
  audit: () => request<{ events: AuditEvent[] }>("/api/audit"),
  createServer: (payload: ServerPayload) => request<{ server: ServerRecord }>("/api/servers", { method: "POST", body: JSON.stringify(payload) }),
  updateServer: (id: string, payload: ServerPayload) =>
    request<{ server: ServerRecord }>(`/api/servers/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  probeServer: (id: string) => request<{ server: ServerRecord }>(`/api/servers/${id}/probe`, { method: "POST" }),
  grantEmergencyRoot: (id: string, durationMs = 8 * 60 * 60_000) => request<{ server: ServerRecord }>(`/api/servers/${id}/emergency-root`, { method: "POST", body: JSON.stringify({ durationMs }) }),
  revokeEmergencyRoot: (id: string) => request<{ server: ServerRecord }>(`/api/servers/${id}/emergency-root/revoke`, { method: "POST" }),
  archiveServer: (id: string) => request<{ archived: boolean }>(`/api/servers/${id}/archive`, { method: "POST" }),
  sessions: () => request<{ sessions: SessionRecord[] }>("/api/sessions"),
  openSession: (serverId: string, requester = "webui") => request<{ session: SessionRecord }>("/api/sessions", { method: "POST", body: JSON.stringify({ serverId, requester }) }),
  session: (id: string) => request<{ session: SessionDetail }>(`/api/sessions/${id}`),
  runCommand: (id: string, command: string, timeoutMs?: number) => request<{ result: unknown; session: SessionDetail | null }>(`/api/sessions/${id}/commands`, { method: "POST", body: JSON.stringify({ command, timeoutMs }) }),
  closeSession: (id: string, reason = "closed_from_webui") => request<{ session: SessionRecord; promoted: SessionRecord | null }>(`/api/sessions/${id}/close`, { method: "POST", body: JSON.stringify({ reason }) }),
  collectMetrics: (serverId: string, sessionId?: string) => request<{ metric: ServerDetail["metric"] }>(`/api/servers/${serverId}/metrics`, { method: "POST", body: JSON.stringify({ sessionId }) }),
  projects: () => request<{ projects: ProjectRecord[] }>("/api/projects"),
  project: (id: string) => request<{ project: ProjectDetail }>(`/api/projects/${id}`),
  createProject: (payload: ProjectPayload) => request<{ project: ProjectDetail }>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: ProjectPayload) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  archiveProject: (id: string) => request<{ archived: boolean }>(`/api/projects/${id}/archive`, { method: "POST" }),
  previewAllVpsSync: () => request<AllVpsSyncPreview>("/api/sync/all-vps/preview"),
  syncAllVps: (sourceDigest: string) =>
    request<AllVpsSyncPreview>("/api/sync/all-vps", { method: "POST", body: JSON.stringify({ sourceDigest }) })
};
