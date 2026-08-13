import { gatewayApiToken, localGatewayBaseUrl, verifyGatewayIdentity } from "../server/auth.js";

const baseUrl = localGatewayBaseUrl();
const apiToken = gatewayApiToken();
await verifyGatewayIdentity(baseUrl, apiToken);

const response = await fetch(`${baseUrl}/api/metrics/all`, {
  method: "POST",
  headers: { "x-ai-vps-gateway-token": apiToken }
});
const payload = (await response.json().catch(() => ({}))) as {
  message?: string;
  summary?: { total: number; success: number; unavailable: number; failed: number };
  results?: Array<{ serverId: string; error?: string }>;
};

if (!response.ok) {
  console.error(payload.message ?? `性能采集失败（HTTP ${response.status}）`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(payload.summary ?? payload, null, 2));
  for (const result of payload.results ?? []) {
    if (result.error) console.error(`${result.serverId}: ${result.error}`);
  }
  if ((payload.summary?.failed ?? 0) > 0) process.exitCode = 2;
}
