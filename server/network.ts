import { execFileSync } from "node:child_process";
import { networkInterfaces } from "node:os";

export function normalizeDirectInterface(value: string | undefined | null): string | null {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_.-]{1,32}$/.test(normalized) ? normalized : null;
}

function defaultRouteInterface(): string | null {
  try {
    const routeBinary = process.platform === "darwin" ? "/sbin/route" : "route";
    const output = execFileSync(routeBinary, ["-n", "get", "default"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const match = /^\s*interface:\s*(\S+)/m.exec(output);
    return normalizeDirectInterface(match?.[1]);
  } catch {
    return null;
  }
}

export function detectDirectInterface(): string | null {
  const configured = normalizeDirectInterface(process.env.ALLVPS_SSH_DIRECT_INTERFACE);
  if (configured) return configured;

  const routed = defaultRouteInterface();
  if (routed && !/^utun/i.test(routed)) return routed;

  const candidates = Object.entries(networkInterfaces())
    .filter(([name, addresses]) =>
      !/^(lo|utun|awdl|llw|anpi|gif|stf)/i.test(name) &&
      (addresses ?? []).some((address) => address.family === "IPv4" && !address.internal)
    )
    .map(([name]) => name);
  return candidates.find((name) => /^en\d+$/i.test(name)) ?? candidates[0] ?? null;
}

export function directBindAddress(interfaceName = detectDirectInterface()): string | null {
  if (!interfaceName) return null;
  const addresses = networkInterfaces()[interfaceName] ?? [];
  const ipv4 = addresses.find((address) => address.family === "IPv4" && !address.internal);
  if (ipv4) return ipv4.address;
  const ipv6 = addresses.find((address) => address.family === "IPv6" && !address.internal);
  return ipv6?.address ?? null;
}
