import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayDatabase } from "./db.js";
import { discoveredProjectsForInventory, parseInventoryOutput } from "./inventory.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("remote project inventory", () => {
  it("parses only safe service metadata and synchronizes deterministic project records", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "盘点测试节点", address: "203.0.113.70", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V1__",
      "META\thostname\tapp-01",
      "META\tos\tUbuntu 24.04",
      "META\tkernel\tLinux 6.8",
      "META\tdocker\tavailable",
      "PROJECT\tdocker\t/srv/demo/compose.yml",
      "PROJECT\tnode\t/srv/demo/client/package.json",
      "SERVICE\tdocker\tdemo-web\tghcr.io/example/web:latest\tUp 2 hours\t0.0.0.0:443->3000/tcp\t/srv/demo",
      "PORT\t0.0.0.0:443",
      ""
    ].join("\n"));

    assert.equal(inventory.projects.length, 2);
    assert.equal(inventory.services.length, 1);
    assert.equal(inventory.services[0]?.ports, "0.0.0.0:443->3000/tcp");
    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.services?.[0]?.critical, true);

    const first = database.syncDiscoveredProject(discovered[0]!);
    assert.equal(first.action, "created");
    assert.equal(first.project.source, "remote-inventory");
    assert.equal(first.project.services.length, 1);
    const second = database.syncDiscoveredProject(discovered[0]!);
    assert.equal(second.action, "unchanged");
    const stale = database.syncDiscoveredProject({
      ...discovered[0]!,
      sourceKey: server.id + ":stale",
      name: "过期自动项目"
    });
    assert.equal(stale.action, "created");
    assert.equal(database.archiveMissingDiscoveredProjects(server.id, [discovered[0]!.sourceKey]), 1);
    database.close();
  });

  it("separates a web application and S-UI while retaining stack, routes and port mappings", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-detailed-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "大阪主站", address: "203.0.113.71", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "META\thostname\tosaka-web-01",
      "META\tos\tUbuntu 24.04",
      "META\tdocker\tavailable",
      "PROJECT\tnode\t/opt/zhongde/releases/20260809/package.json",
      "CONTAINER_PACKAGE\tzongde-web\tzhongde-b2b-site\t@prisma/client,next,react,typescript,tailwindcss,pgvector,zod",
      "SERVICE\tdocker\tzongde-web\tzhongde-web:20260809\trunning / health=healthy\t\t3000/tcp\t/opt/zhongde\tzongde\t/app\t/opt/zhongde/releases/current -> /app",
      "SERVICE\tdocker\tzongde-nginx\tnginx:1.27-alpine\trunning\t80/tcp -> 0.0.0.0:80; 443/tcp -> 0.0.0.0:443\t80/tcp 443/tcp\t/opt/zhongde\tzongde\t\t/etc/zhongde/nginx -> /etc/nginx/conf.d",
      "SERVICE\tdocker\tzongde-postgres\tpgvector/pgvector:pg16\trunning\t\t5432/tcp\t/opt/zhongde\tzongde\t\t/opt/zhongde/postgres -> /var/lib/postgresql/data",
      "SERVICE\tdocker\ts-ui\talireza7/s-ui:latest\trunning\t2095/tcp -> 0.0.0.0:2095; 8388/tcp -> 0.0.0.0:8388\t2095/tcp 8388/tcp\t\ts-ui\t/app\t",
      "WEB\tnginx\t/etc/zhongde/nginx/site.conf\tserver_name zongde.ltd www.zongde.ltd;",
      "WEB\tnginx\t/etc/zhongde/nginx/site.conf\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/zhongde/nginx/site.conf\tproxy_pass http://zhongde-web:3100;",
      "PORT\ttcp\t0.0.0.0:80",
      "PORT\ttcp\t0.0.0.0:443",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    const zongde = discovered.find((project) => project.name === "大阪主站 · zongde");
    const sui = discovered.find((project) => project.name === "大阪主站 · S-UI");
    assert.ok(zongde);
    assert.ok(sui);
    assert.equal(zongde.services?.length, 3);
    assert.deepEqual(zongde.webEndpoints, [
      {
        label: "www.zongde.ltd",
        url: "https://www.zongde.ltd",
        port: 443,
        serviceName: "zongde-web",
        notes: "上游：http://zhongde-web:3100；配置摘要：/etc/zhongde/nginx/site.conf",
        source: "remote-inventory"
      },
      {
        label: "zongde.ltd",
        url: "https://zongde.ltd",
        port: 443,
        serviceName: "zongde-web",
        notes: "上游：http://zhongde-web:3100；配置摘要：/etc/zhongde/nginx/site.conf",
        source: "remote-inventory"
      }
    ]);
    assert.ok(zongde.technologyStack?.includes("Next.js"));
    assert.ok(zongde.technologyStack?.includes("pgvector"));
    assert.ok(zongde.services?.some((service) => service.name === "zongde-nginx" && service.portMappings?.includes("443/tcp -> 0.0.0.0:443")));
    assert.equal(sui.services?.length, 1);
    assert.ok(sui.technologyStack?.includes("S-UI"));
    assert.equal(sui.webEndpoints?.length, 0);
    const saved = database.syncDiscoveredProject(zongde);
    assert.deepEqual(saved.project.webEndpoints, zongde.webEndpoints);
    assert.deepEqual(saved.project.technologyStack, zongde.technologyStack);
    assert.ok(saved.project.services.some((service) => service.portMappings.includes("443/tcp -> 0.0.0.0:443")));
    database.close();
  });

  it("merges an Nginx domain with the project served by a PM2 process", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-proxy-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "国内节点", address: "203.0.113.72", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "META\thostname\tcontest-01",
      "META\tos\tUbuntu 24.04",
      "PROJECT\tnode\t/opt/payment_approval/package.json",
      "SERVICE\tprocess\tpm2:payment-api\tpayment-api\tonline\t127.0.0.1:3334\t/opt/payment_approval/server\tpm2\t/opt/payment_approval/server\t",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "WEB\tnginx\t/etc/nginx/conf.d/pay.kukuaki.me.conf\tserver_name pay.kukuaki.me;",
      "WEB\tnginx\t/etc/nginx/conf.d/pay.kukuaki.me.conf\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/pay.kukuaki.me.conf\troot /opt/payment_approval/client/dist;",
      "WEB\tnginx\t/etc/nginx/conf.d/pay.kukuaki.me.conf\tproxy_pass http://127.0.0.1:3334/api/;",
      "PORT\ttcp\t0.0.0.0:443",
      "PORT\ttcp\t127.0.0.1:3334",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    const payment = discovered[0]!;
    assert.equal(payment.name, "国内节点 · payment_approval");
    const endpoints = payment.webEndpoints ?? [];
    assert.deepEqual(endpoints.map((endpoint) => endpoint.url), ["https://pay.kukuaki.me"]);
    assert.equal(endpoints[0]?.serviceName, "payment-api");
    assert.ok(payment.services?.some((service) => service.manager === "process" && service.name === "payment-api" && service.port === 3334));
    assert.ok(payment.services?.some((service) => service.manager === "systemd" && service.name === "nginx"));
    assert.ok(payment.technologyStack?.includes("PM2"));
    assert.ok(payment.technologyStack?.includes("Nginx"));
    assert.ok(payment.runbook.overview.includes("pay.kukuaki.me -> payment-api"));
    assert.equal(database.syncDiscoveredProject(payment).action, "created");
    assert.equal(database.syncDiscoveredProject(payment).action, "unchanged");
    database.close();
  });

  it("keeps an unresolved domain inside the unclassified service group", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-unclassified-route-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "代理节点", address: "203.0.113.73", sshPort: 22, sshUser: "root" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "META\thostname\tproxy-01",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "SERVICE\tsystemd\tsing-box.service\tactive / running\t\t\t/usr/lib/systemd/system/sing-box.service\t\t\t",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf\tserver_name cf-node.example.com;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf\tproxy_pass http://127.0.0.1:10085;",
      "PORT\ttcp\t127.0.0.1:10085",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.name, "代理节点 · 未归类服务");
    assert.deepEqual(discovered[0]?.webEndpoints?.map((endpoint) => endpoint.url), ["https://cf-node.example.com"]);
    assert.ok(discovered[0]?.services?.some((service) => service.name === "nginx"));
    assert.ok(discovered[0]?.services?.some((service) => service.name === "sing-box"));
    assert.ok(!discovered.some((project) => project.sourceKey.includes(":web:")));
    database.close();
  });
});
