import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

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
});
