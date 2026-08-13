import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { GatewayDatabase } from "./db.js";
import type { DiscoveredProjectInput, ProjectRunbook } from "./types.js";

const temporaryDirectories: string[] = [];

function inventoryRunbook(version: string): ProjectRunbook {
  return {
    overview: `自动概览 ${version}`,
    deployment: `自动部署 ${version}`,
    verification: `自动验证 ${version}`,
    troubleshooting: `自动排错 ${version}`,
    guardrails: `自动边界 ${version}`
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("project records", () => {
  it("persists runbooks, server links and managed services", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-project-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "项目测试节点",
      address: "203.0.113.20",
      sshPort: 22,
      sshUser: "ubuntu"
    });

    const created = database.createProject({
      name: "支付站",
      description: "线上支付项目",
      repositoryUrl: "https://github.com/example/payment",
      runbook: {
        overview: "统一入口与支付 API",
        deployment: "先备份，再发布镜像",
        verification: "检查首页和支付回调",
        troubleshooting: "先看 Nginx 与应用日志",
        guardrails: "不要直接修改数据库和 SSH"
      },
      servers: [{ serverId: server.id, role: "primary" }],
      services: [{
        serverId: server.id,
        name: "payment-api",
        manager: "systemd",
        identifier: "payment-api.service",
        port: 3334,
        accessUrl: "https://pay.example.test",
        critical: true,
        notes: "回调入口依赖 Nginx"
      }]
    });

    assert.equal(database.listProjects()[0]?.serviceCount, 1);
    assert.equal(database.listProjects()[0]?.criticalServiceCount, 1);
    assert.equal(created.runbook.guardrails, "不要直接修改数据库和 SSH");
    assert.equal(created.servers[0]?.role, "primary");
    assert.equal(created.services[0]?.identifier, "payment-api.service");

    const updated = database.updateProject(created.id, { description: "已更新说明" });
    assert.equal(updated?.description, "已更新说明");
    assert.equal(updated?.services.length, 1);
    assert.equal(updated?.servers.length, 1);

    assert.throws(
      () => database.createProject({
        name: "非法项目",
        services: [{ serverId: "00000000-0000-4000-8000-000000000000", name: "bad", manager: "process", identifier: "bad" }]
      }),
      /服务.*必须关联/
    );

    assert.equal(database.archiveProject(created.id), true);
    assert.equal(database.listProjects().length, 0);
    assert.equal(database.getProject(created.id), null);
    assert.equal(database.getProject(created.id, true)?.name, "支付站");
    database.close();
  });

  it("preserves manual project knowledge while refreshing remote inventory fields", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-project-inventory-merge-"));
    temporaryDirectories.push(directory);
    const database = new GatewayDatabase(directory);
    const server = database.createServer({
      name: "盘点合并节点",
      address: "203.0.113.21",
      sshPort: 22,
      sshUser: "ubuntu"
    });
    const initial: DiscoveredProjectInput = {
      sourceKey: `${server.id}:/srv/app`,
      name: "盘点合并节点 · app",
      description: "自动描述 v1",
      repositoryPath: "/srv/app-v1",
      serverId: server.id,
      technologyStack: ["Node.js"],
      webEndpoints: [{
        label: "自动入口 v1",
        url: "https://app.example.test",
        port: 443,
        serviceName: "app-web",
        notes: "自动入口备注 v1",
        source: "remote-inventory"
      }],
      runbook: inventoryRunbook("v1"),
      services: [
        {
          serverId: server.id,
          name: "app-web",
          manager: "docker",
          identifier: "app-web",
          port: 3000,
          portMappings: ["127.0.0.1:3000 -> 3000/tcp"],
          critical: false,
          notes: "自动服务备注 v1"
        },
        {
          serverId: server.id,
          name: "old-worker",
          manager: "systemd",
          identifier: "old-worker.service",
          critical: false,
          notes: "自动旧服务"
        }
      ]
    };
    const created = database.syncDiscoveredProject(initial).project;
    const editedRunbook = {
      ...created.runbook,
      overview: "Agent 维护的架构概览",
      troubleshooting: "Agent 维护的排错手册"
    };
    const edited = database.updateProject(created.id, {
      name: "人工项目名称",
      description: "人工维护的项目描述",
      technologyStack: ["Node.js", "业务专用 SDK"],
      runbook: editedRunbook,
      webEndpoints: [
        ...created.webEndpoints,
        {
          label: "人工入口",
          url: "https://manual.example.test",
          port: 443,
          serviceName: "app-web",
          notes: "人工维护，不得覆盖",
          source: "manual"
        }
      ],
      services: [
        ...created.services.map((service) => ({
          serverId: service.serverId,
          name: service.name,
          manager: service.manager,
          identifier: service.identifier,
          port: service.port,
          portMappings: service.portMappings,
          accessUrl: service.accessUrl,
          critical: service.identifier === "app-web" ? true : service.critical,
          notes: service.identifier === "app-web" ? "人工关键服务备注" : service.notes
        })),
        {
          serverId: server.id,
          name: "人工巡检项",
          manager: "external",
          identifier: "manual-check",
          critical: true,
          notes: "人工新增服务"
        }
      ]
    });
    assert.ok(edited);

    const second = database.syncDiscoveredProject({
      ...initial,
      name: "自动名称 v2",
      description: "自动描述 v2",
      repositoryPath: "/srv/app-v2",
      technologyStack: ["Nginx", "Node.js", "TypeScript"],
      webEndpoints: [
        {
          label: "自动尝试覆盖人工入口",
          url: "https://manual.example.test",
          port: 443,
          serviceName: "app-web",
          notes: "自动备注 v2",
          source: "remote-inventory"
        },
        {
          label: "新自动入口",
          url: "https://new-app.example.test",
          port: 443,
          serviceName: "app-web",
          notes: "自动入口备注 v2",
          source: "remote-inventory"
        }
      ],
      runbook: inventoryRunbook("v2"),
      services: [
        {
          serverId: server.id,
          name: "app-web-v2",
          manager: "docker",
          identifier: "app-web",
          port: 3200,
          portMappings: ["127.0.0.1:3200 -> 3200/tcp"],
          critical: false,
          notes: "自动服务备注 v2"
        },
        {
          serverId: server.id,
          name: "scheduler",
          manager: "systemd",
          identifier: "scheduler.service",
          critical: false,
          notes: "自动新增服务 v2"
        }
      ]
    });

    assert.equal(second.action, "updated");
    assert.equal(second.project.name, "人工项目名称");
    assert.equal(second.project.description, "人工维护的项目描述");
    assert.equal(second.project.repositoryPath, "/srv/app-v2");
    assert.deepEqual(second.project.technologyStack, ["Nginx", "Node.js", "TypeScript", "业务专用 SDK"]);
    assert.equal(second.project.runbook.overview, "Agent 维护的架构概览");
    assert.equal(second.project.runbook.troubleshooting, "Agent 维护的排错手册");
    assert.equal(second.project.runbook.deployment, "自动部署 v2");
    assert.equal(second.project.runbook.verification, "自动验证 v2");
    assert.equal(second.project.runbook.guardrails, "自动边界 v2");
    assert.ok(!second.project.webEndpoints.some((endpoint) => endpoint.url === "https://app.example.test"));
    assert.deepEqual(
      second.project.webEndpoints.map((endpoint) => [endpoint.url, endpoint.source, endpoint.notes]),
      [
        ["https://manual.example.test", "manual", "人工维护，不得覆盖"],
        ["https://new-app.example.test", "remote-inventory", "自动入口备注 v2"]
      ]
    );
    assert.ok(!second.project.services.some((service) => service.identifier === "old-worker.service"));
    const refreshedWeb = second.project.services.find((service) => service.identifier === "app-web");
    assert.equal(refreshedWeb?.name, "app-web-v2");
    assert.equal(refreshedWeb?.port, 3200);
    assert.deepEqual(refreshedWeb?.portMappings, ["127.0.0.1:3200 -> 3200/tcp"]);
    assert.equal(refreshedWeb?.critical, true);
    assert.equal(refreshedWeb?.notes, "人工关键服务备注");
    assert.ok(second.project.services.some((service) => service.identifier === "manual-check"));
    assert.ok(second.project.services.some((service) => service.identifier === "scheduler.service"));

    const third = database.syncDiscoveredProject({
      ...initial,
      name: "自动名称 v3",
      description: "自动描述 v3",
      repositoryPath: "/srv/app-v3",
      technologyStack: ["Node.js"],
      webEndpoints: [],
      runbook: inventoryRunbook("v3"),
      services: [{
        serverId: server.id,
        name: "app-web-v3",
        manager: "docker",
        identifier: "app-web",
        port: 3300,
        portMappings: ["127.0.0.1:3300 -> 3300/tcp"],
        critical: false,
        notes: "自动服务备注 v3"
      }]
    });
    assert.equal(third.project.name, "人工项目名称");
    assert.equal(third.project.description, "人工维护的项目描述");
    assert.equal(third.project.runbook.overview, "Agent 维护的架构概览");
    assert.equal(third.project.runbook.deployment, "自动部署 v3");
    assert.deepEqual(third.project.technologyStack, ["Node.js", "业务专用 SDK"]);
    assert.deepEqual(third.project.webEndpoints.map((endpoint) => endpoint.url), ["https://manual.example.test"]);
    assert.ok(!third.project.services.some((service) => service.identifier === "scheduler.service"));
    assert.ok(third.project.services.some((service) => service.identifier === "manual-check"));
    const thirdWeb = third.project.services.find((service) => service.identifier === "app-web");
    assert.equal(thirdWeb?.name, "app-web-v3");
    assert.equal(thirdWeb?.port, 3300);
    assert.equal(thirdWeb?.critical, true);
    assert.equal(thirdWeb?.notes, "人工关键服务备注");
    database.close();
  });

  it("adds the inventory baseline column when opening a legacy database", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-project-legacy-schema-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "gateway.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'manual',
        source_key TEXT,
        source_synced_at TEXT,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        repository_url TEXT,
        repository_path TEXT,
        technology_stack_json TEXT NOT NULL DEFAULT '[]',
        web_endpoints_json TEXT NOT NULL DEFAULT '[]',
        runbook_json TEXT NOT NULL DEFAULT '{}',
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacy.close();

    const database = new GatewayDatabase(directory);
    const migrated = new DatabaseSync(databasePath);
    const columns = migrated.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === "inventory_baseline_json"));
    migrated.close();
    database.close();
  });
});
