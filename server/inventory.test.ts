import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayDatabase } from "./db.js";
import { INVENTORY_COMMAND, discoveredProjectsForInventory, parseInventoryOutput } from "./inventory.js";

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
    const refreshed = database.syncDiscoveredProject({
      ...discovered[0]!,
      technologyStack: ["Nginx", "sing-box"]
    });
    assert.equal(refreshed.action, "updated");
    assert.deepEqual(refreshed.project.technologyStack, ["Nginx", "sing-box"]);
    const stale = database.syncDiscoveredProject({
      ...discovered[0]!,
      sourceKey: server.id + ":stale",
      name: "过期自动项目"
    });
    assert.equal(stale.action, "created");
    assert.equal(database.archiveMissingDiscoveredProjects(server.id, [discovered[0]!.sourceKey]), 1);
    assert.deepEqual(database.projectsForServer(server.id, true).map((project) => project.id), [first.project.id]);
    assert.equal(database.getProject(stale.project.id, true)?.services.length, 0);
    database.close();
  });

  it("separates a web application and S-UI while retaining stack, routes and port mappings", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-detailed-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "应用节点", address: "203.0.113.71", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "META\thostname\tosaka-web-01",
      "META\tos\tUbuntu 24.04",
      "META\tdocker\tavailable",
      "PROJECT\tnode\t/opt/atlas/releases/20260809/package.json",
      "CONTAINER_PACKAGE\tatlas-web\tatlas-business-site\t@prisma/client,next,react,typescript,tailwindcss,pgvector,zod",
      "SERVICE\tdocker\tatlas-web\tatlas-web:20260809\trunning / health=healthy\t\t3000/tcp\t/opt/atlas\tatlas\t/app\t/opt/atlas/releases/current -> /app",
      "SERVICE\tdocker\tatlas-nginx\tnginx:1.27-alpine\trunning\t80/tcp -> 0.0.0.0:80; 443/tcp -> 0.0.0.0:443\t80/tcp 443/tcp\t/opt/atlas\tatlas\t\t/etc/atlas/nginx -> /etc/nginx/conf.d",
      "SERVICE\tdocker\tatlas-postgres\tpgvector/pgvector:pg16\trunning\t\t5432/tcp\t/opt/atlas\tatlas\t\t/opt/atlas/postgres -> /var/lib/postgresql/data",
      "SERVICE\tdocker\ts-ui\talireza7/s-ui:latest\trunning\t2095/tcp -> 0.0.0.0:2095; 8388/tcp -> 0.0.0.0:8388\t2095/tcp 8388/tcp\t\ts-ui\t/app\t",
      "WEB\tnginx\t/etc/atlas/nginx/site.conf\tserver_name atlas.example.test www.atlas.example.test;",
      "WEB\tnginx\t/etc/atlas/nginx/site.conf\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/atlas/nginx/site.conf\tproxy_pass http://atlas-web:3100;",
      "PORT\ttcp\t0.0.0.0:80",
      "PORT\ttcp\t0.0.0.0:443",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    const atlas = discovered.find((project) => project.name === "应用节点 · atlas");
    const sui = discovered.find((project) => project.name === "应用节点 · S-UI");
    assert.ok(atlas);
    assert.ok(sui);
    assert.equal(atlas.services?.length, 3);
    assert.deepEqual(atlas.webEndpoints, [
      {
        label: "atlas.example.test",
        url: "https://atlas.example.test",
        port: 443,
        serviceName: "atlas-web",
        notes: "上游：http://atlas-web:3100；配置摘要：/etc/atlas/nginx/site.conf",
        source: "remote-inventory"
      },
      {
        label: "www.atlas.example.test",
        url: "https://www.atlas.example.test",
        port: 443,
        serviceName: "atlas-web",
        notes: "上游：http://atlas-web:3100；配置摘要：/etc/atlas/nginx/site.conf",
        source: "remote-inventory"
      }
    ]);
    assert.ok(atlas.technologyStack?.includes("Next.js"));
    assert.ok(atlas.technologyStack?.includes("pgvector"));
    assert.ok(atlas.services?.some((service) => service.name === "atlas-nginx" && service.portMappings?.includes("443/tcp -> 0.0.0.0:443")));
    assert.equal(sui.services?.length, 1);
    assert.ok(sui.technologyStack?.includes("S-UI"));
    assert.deepEqual(sui.webEndpoints, [
      {
        label: "S-UI 管理面板",
        url: "http://203.0.113.71:2095/app/",
        port: 2095,
        serviceName: "s-ui",
        notes: "S-UI 默认管理路径；由公网 Docker 端口映射识别，请确认登录认证和防火墙策略。",
        source: "remote-inventory"
      }
    ]);
    const saved = database.syncDiscoveredProject(atlas);
    assert.deepEqual(saved.project.webEndpoints, atlas.webEndpoints);
    assert.deepEqual(saved.project.technologyStack, atlas.technologyStack);
    assert.ok(saved.project.services.some((service) => service.portMappings.includes("443/tcp -> 0.0.0.0:443")));
    database.close();
  });

  it("merges an Nginx domain with the project served by a PM2 process", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-proxy-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "业务节点", address: "203.0.113.72", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "META\thostname\tops-01",
      "META\tos\tUbuntu 24.04",
      "PROJECT\tnode\t/opt/billing_portal/package.json",
      "SERVICE\tprocess\tpm2:billing-api\tbilling-api\tonline\t127.0.0.1:3334\t/opt/billing_portal/server\tpm2\t/opt/billing_portal/server\t",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-1\tlisten 80;",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-1\tserver_name billing.example.test;",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-2\tserver_name billing.example.test;",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-2\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-2\troot /opt/billing_portal/client/dist;",
      "WEB\tnginx\t/etc/nginx/conf.d/billing.example.test.conf#server-2\tproxy_pass http://127.0.0.1:3334/api/;",
      "PORT\ttcp\t0.0.0.0:443",
      "PORT\ttcp\t127.0.0.1:3334",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    const payment = discovered[0]!;
    assert.equal(payment.name, "业务节点 · billing_portal");
    const endpoints = payment.webEndpoints ?? [];
    assert.deepEqual(endpoints.map((endpoint) => endpoint.url), ["https://billing.example.test"]);
    assert.equal(endpoints[0]?.serviceName, "billing-api");
    assert.ok(payment.services?.some((service) => service.manager === "process" && service.name === "billing-api" && service.port === 3334));
    assert.ok(payment.services?.some((service) => service.manager === "systemd" && service.name === "nginx"));
    assert.ok(payment.technologyStack?.includes("PM2"));
    assert.ok(payment.technologyStack?.includes("Nginx"));
    assert.ok(payment.runbook.overview.includes("billing.example.test -> billing-api"));
    assert.equal(database.syncDiscoveredProject(payment).action, "created");
    assert.equal(database.syncDiscoveredProject(payment).action, "unchanged");
    database.close();
  });

  it("creates a PM2 project from its working directory when no manifest was found", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-process-project-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "边缘节点", address: "203.0.113.75", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "SERVICE\tprocess\tpm2:catalog-api\tcatalog-api\tonline\t\t/www/catalog\tcatalog\t/www/catalog\t",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.test#server-1\tserver_name catalog.example.test;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.test#server-1\tlisten 80;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.test#server-1\tproxy_pass http://127.0.0.1:3000;",
      ""
    ].join("\n"));
    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.name, "边缘节点 · catalog");
    assert.equal(discovered[0]?.repositoryPath, "/www/catalog");
    assert.ok(discovered[0]?.services?.some((service) => service.identifier === "pm2:catalog-api"));
    assert.deepEqual(discovered[0]?.webEndpoints?.map((endpoint) => endpoint.url), ["http://catalog.example.test"]);
    database.close();
  });

  it("does not attach a server health-check domain to an unrelated project", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-health-domain-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "边缘节点",
      address: "203.0.113.76",
      sshPort: 22,
      sshUser: "ubuntu",
      healthChecks: [{
        name: "Cloudflare node",
        kind: "http",
        config: { url: "https://cf-singapore.example.com", expectedStatusCodes: [200] }
      }]
    });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "SERVICE\tprocess\tpm2:catalog-api\tcatalog-api\tonline\t\t/www/catalog\tcatalog\t/www/catalog\t",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.com#server-1\tserver_name catalog.example.com;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.com#server-1\tlisten 80;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/catalog.example.com#server-1\tproxy_pass http://127.0.0.1:3000;",
      ""
    ].join("\n"));
    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 1);
    assert.deepEqual(discovered[0]?.webEndpoints?.map((endpoint) => endpoint.url), ["http://catalog.example.com"]);
    assert.ok(!discovered.some((project) => project.webEndpoints?.some((endpoint) => endpoint.url.includes("cf-singapore"))));
    database.close();
  });

  it("reads enabled Nginx server blocks and associates contest endpoints without treating ACME roots as sites", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-contest-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "国内节点", address: "203.0.113.74", sshPort: 22, sshUser: "ubuntu" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "PROJECT\tnode\t/opt/event-console/package.json",
      "SERVICE\tsystemd\tevent-console.service\tactive / running\t\t\t/etc/systemd/system/event-console.service\t\t/opt/event-console\t",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-1\tlisten 80;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-1\tserver_name admin.event.example.test download.event.example.test;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-1\troot /var/www/letsencrypt;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-2\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-2\tserver_name admin.event.example.test;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-2\tproxy_pass http://127.0.0.1:3000;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-3\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-3\tserver_name download.event.example.test;",
      "WEB\tnginx\t/etc/nginx/sites-enabled/event-console#server-3\troot /home/download;",
      ""
    ].join("\n"));

    assert.equal(inventory.webRoutes.length, 3);
    assert.ok(inventory.webRoutes.every((route) => route.configPath === "/etc/nginx/sites-enabled/event-console"));
    const contest = discoveredProjectsForInventory(server, inventory).find((project) => project.name === "国内节点 · event-console");
    assert.ok(contest);
    assert.deepEqual(contest.webEndpoints?.map((endpoint) => endpoint.url), [
      "https://admin.event.example.test",
      "https://download.event.example.test"
    ]);
    assert.ok(contest.webEndpoints?.every((endpoint) => !endpoint.notes.includes("letsencrypt")));
    assert.ok(INVENTORY_COMMAND.includes('find -L "$root"'));
    assert.ok(INVENTORY_COMMAND.includes('$root/sites-enabled/*'));
    database.close();
  });

  it("merges an Nginx Cloudflare edge into the unresolved sing-box project", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-sing-box-edge-"));
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
    const singBox = discovered.find((project) => project.name === "代理节点 · sing-box");
    assert.ok(singBox);
    assert.equal(singBox.sourceKey, server.id + ":service:systemd:sing-box.service");
    assert.deepEqual(singBox.webEndpoints?.map((endpoint) => endpoint.url), ["https://cf-node.example.com"]);
    assert.equal(singBox.services?.length, 2);
    assert.ok(singBox.services?.some((service) => service.name === "nginx"));
    assert.ok(singBox.services?.some((service) => service.name === "sing-box"));
    assert.ok(singBox.technologyStack?.includes("Nginx"));
    assert.ok(singBox.technologyStack?.includes("sing-box"));
    assert.ok(!discovered.some((project) => project.name.includes("未归类")));
    assert.ok(!discovered.some((project) => project.sourceKey.includes(":web:")));

    const legacy = database.syncDiscoveredProject({
      ...singBox,
      sourceKey: server.id + ":unassigned",
      name: "代理节点 · 未归类服务",
      services: singBox.services
    });
    for (const project of discovered) database.syncDiscoveredProject(project);
    assert.equal(database.archiveMissingDiscoveredProjects(server.id, discovered.map((project) => project.sourceKey)), 1);
    assert.ok(database.getProject(legacy.project.id, true)?.archivedAt);
    database.close();
  });

  it("keeps separate upstream applications that share one Nginx service", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-shared-nginx-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "共享入口节点", address: "203.0.113.78", sshPort: 22, sshUser: "root" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "SERVICE\tprocess\tpid:101\talpha-api\trunning\t127.0.0.1:3101\t\t\t\t",
      "SERVICE\tprocess\tpid:102\tbeta-api\trunning\t127.0.0.1:3102\t\t\t\t",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.com.conf#server-1\tserver_name alpha.example.com;",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.com.conf#server-1\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.com.conf#server-1\tproxy_pass http://127.0.0.1:3101;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.com.conf#server-1\tserver_name beta.example.com;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.com.conf#server-1\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.com.conf#server-1\tproxy_pass http://127.0.0.1:3102;",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 2);
    const alpha = discovered.find((project) => project.name === "共享入口节点 · alpha-api");
    const beta = discovered.find((project) => project.name === "共享入口节点 · beta-api");
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(alpha.sourceKey, server.id + ":service:process:pid:101");
    assert.equal(beta.sourceKey, server.id + ":service:process:pid:102");
    assert.deepEqual(alpha.webEndpoints?.map((endpoint) => endpoint.url), ["https://alpha.example.com"]);
    assert.deepEqual(beta.webEndpoints?.map((endpoint) => endpoint.url), ["https://beta.example.com"]);
    assert.deepEqual(alpha.services?.map((service) => service.name).sort(), ["alpha-api", "nginx"]);
    assert.deepEqual(beta.services?.map((service) => service.name).sort(), ["beta-api", "nginx"]);
    database.close();
  });

  it("isolates a sing-box proxy route from unrelated applications on the same Nginx host", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-mixed-sing-box-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "混合业务节点", address: "203.0.113.79", sshPort: 22, sshUser: "root" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "PROJECT\tnode\t/opt/alpha/package.json",
      "PROJECT\tnode\t/opt/beta/package.json",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "SERVICE\tsystemd\tsing-box.service\tactive / running\t\t\t/usr/lib/systemd/system/sing-box.service\t\t\t",
      "SERVICE\tprocess\tpm2:alpha\talpha\tonline\t127.0.0.1:3101\t/opt/alpha\talpha\t/opt/alpha\t",
      "SERVICE\tprocess\tpm2:beta\tbeta\tonline\t127.0.0.1:3102\t/opt/beta\tbeta\t/opt/beta\t",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.test.conf#server-1\tserver_name alpha.example.test;",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.test.conf#server-1\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/alpha.example.test.conf#server-1\tproxy_pass http://127.0.0.1:3101;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.test.conf#server-1\tserver_name beta.example.test;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.test.conf#server-1\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/beta.example.test.conf#server-1\tproxy_pass http://127.0.0.1:3102;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.test.conf#server-1\tserver_name cf-node.example.test;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.test.conf#server-1\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.test.conf#server-1\tproxy_pass http://127.0.0.1:10085;",
      "PORT\ttcp\t127.0.0.1:10085",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    assert.equal(discovered.length, 3);
    const alpha = discovered.find((project) => project.name === "混合业务节点 · alpha");
    const beta = discovered.find((project) => project.name === "混合业务节点 · beta");
    const singBox = discovered.find((project) => project.name === "混合业务节点 · sing-box");
    assert.ok(alpha);
    assert.ok(beta);
    assert.ok(singBox);
    assert.deepEqual(alpha.webEndpoints?.map((endpoint) => endpoint.url), ["https://alpha.example.test"]);
    assert.deepEqual(beta.webEndpoints?.map((endpoint) => endpoint.url), ["https://beta.example.test"]);
    assert.deepEqual(singBox.webEndpoints?.map((endpoint) => endpoint.url), ["https://cf-node.example.test"]);
    for (const project of [alpha, beta]) {
      assert.ok(!project.services?.some((service) => service.name === "sing-box"));
      assert.ok(!project.technologyStack?.includes("sing-box"));
      assert.ok(!project.webEndpoints?.some((endpoint) => endpoint.url.includes("cf-node")));
    }
    assert.deepEqual(singBox.services?.map((service) => service.name).sort(), ["nginx", "sing-box"]);
    assert.ok(!singBox.webEndpoints?.some((endpoint) => endpoint.url.includes("alpha") || endpoint.url.includes("beta")));
    database.close();
  });

  it("prefers a Cloudflare node's HTTPS proxy route over its certbot challenge route", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-inventory-certbot-route-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({ name: "代理节点", address: "203.0.113.77", sshPort: 22, sshUser: "root" });
    const inventory = parseInventoryOutput(server.id, [
      "__AI_VPS_GATEWAY_INVENTORY_V2__",
      "SERVICE\tsystemd\tnginx.service\tactive / running\t\t\t/usr/lib/systemd/system/nginx.service\t\t\t",
      "SERVICE\tsystemd\tsing-box.service\tactive / running\t\t\t/usr/lib/systemd/system/sing-box.service\t\t\t",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-1\tserver_name cf-node.example.com;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-1\tlisten 80;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-1\troot /var/www/certbot;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-2\tserver_name cf-node.example.com;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-2\tlisten 443 ssl;",
      "WEB\tnginx\t/etc/nginx/conf.d/cf-node.example.com.conf#server-2\tproxy_pass http://127.0.0.1:10085;",
      ""
    ].join("\n"));

    const discovered = discoveredProjectsForInventory(server, inventory);
    const singBox = discovered.find((project) => project.name === "代理节点 · sing-box");
    assert.ok(singBox);
    assert.deepEqual(singBox.webEndpoints?.map((endpoint) => endpoint.url), ["https://cf-node.example.com"]);
    assert.ok(singBox.webEndpoints?.[0]?.notes.includes("127.0.0.1:10085"));
    database.close();
  });
});
