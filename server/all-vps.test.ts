import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { applyAllVpsSync, parseAllVpsDocuments, previewAllVpsSync } from "./all-vps.js";
import { GatewayDatabase } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const inventoryMarkdown = `# VPS 资产与运行服务清单

## 总览

| 节点 | SSH | 系统与资源 | 主要运行内容 | 主机可见公网监听 |
| --- | --- | --- | --- | --- |
| 应用节点 | \`ubuntu@203.0.113.10:22\` | Ubuntu | Docker：Nginx、PostgreSQL | \`22\`、\`443\` |
| 代理节点 | \`root@203.0.113.11:47680\` | Ubuntu | Docker：S-UI | \`47680\`、\`443\` |
`;

const domainsMarkdown = `# 域名与源站映射

| 主机名 / 规则 | Cloudflare / DNS 状态 | 当前源站 | 用途与审计结果 |
| --- | --- | --- | --- |
| app.example.test | DNS-only | 应用节点 \`203.0.113.10\` | HTTPS 返回 \`200\` |
| edge.example.test | Cloudflare 代理 | 代理节点 \`203.0.113.11\` | 访问根路径返回 \`404\` |
| wsNN.example.test | DNS-only | 应用节点 \`203.0.113.10\` | HTTP 静态站 |
`;

describe("all-vps document synchronization", () => {
  it("parses documented metadata without credential references and syncs idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "ai-vps-gateway-all-vps-"));
    temporaryDirectories.push(directory);
    const document = parseAllVpsDocuments(inventoryMarkdown, domainsMarkdown, {
      directory,
      inventoryPath: join(directory, "VPS_INVENTORY.md"),
      domainsPath: join(directory, "DOMAINS.md")
    });

    assert.equal(document.assets.length, 2);
    assert.equal(document.assets[0]?.input.credentialRef, undefined);
    assert.deepEqual(document.assets[0]?.input.healthChecks?.[0]?.config, {
      url: "https://app.example.test",
      expectedStatusCodes: [200]
    });
    assert.deepEqual(document.assets[1]?.input.healthChecks?.[0]?.config, {
      url: "https://edge.example.test",
      expectedStatusCodes: [404]
    });

    const database = new GatewayDatabase(directory);
    const firstPreview = previewAllVpsSync(database, document);
    assert.deepEqual(firstPreview.summary, { created: 2, updated: 0, unchanged: 0, stale: 0 });

    const firstSync = applyAllVpsSync(database, document);
    assert.equal(firstSync.summary.created, 2);
    const application = database.listServers().find((server) => server.address === "203.0.113.10");
    assert.equal(application?.source, "all-vps");
    assert.equal(application?.credentialRef, null);
    assert.equal(application?.networkMode, "direct");

    database.updateServer(application?.id as string, { credentialRef: "macos-keychain:application", maintenance: true });
    const secondSync = applyAllVpsSync(database, document);
    assert.equal(secondSync.summary.unchanged, 2);
    const afterSecondSync = database.getServer(application?.id as string);
    assert.equal(afterSecondSync?.credentialRef, "macos-keychain:application");
    assert.equal(afterSecondSync?.maintenance, true);
    database.close();
  });
});
