import type { AuditEvent, DashboardResponse, ServerDetail, ServerPayload, ServerRecord } from "./types";

interface ApiErrorPayload {
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
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
  archiveServer: (id: string) => request<{ archived: boolean }>(`/api/servers/${id}/archive`, { method: "POST" })
};
