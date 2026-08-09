const baseUrl = process.env.ALLVPS_API_URL ?? "http://127.0.0.1:4318";

const response = await fetch(`${baseUrl}/api/inventory/all-vps/sync-projects`, { method: "POST" });
const payload = (await response.json().catch(() => ({}))) as {
  message?: string;
  summary?: { total: number; success: number; failed: number; created: number; updated: number };
  results?: Array<{ serverId: string; error?: string; projects?: Array<unknown> }>;
};

if (!response.ok) {
  console.error(payload.message ?? `项目同步失败（HTTP ${response.status}）`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(payload.summary ?? payload, null, 2));
  for (const result of payload.results ?? []) {
    if (result.error) console.error(`${result.serverId}: ${result.error}`);
  }
  if ((payload.summary?.failed ?? 0) > 0) process.exitCode = 2;
}
