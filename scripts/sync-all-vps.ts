import { applyAllVpsSync, loadAllVpsDocument, previewAllVpsSync } from "../server/all-vps.js";
import { GatewayDatabase } from "../server/db.js";

const supportedArguments = new Set(["--dry-run"]);
const unsupported = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupported.length) {
  throw new Error(`不支持的参数：${unsupported.join(" ")}。可用参数：--dry-run`);
}

const dryRun = process.argv.includes("--dry-run");
const database = new GatewayDatabase();

try {
  const document = loadAllVpsDocument();
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(previewAllVpsSync(database, document), null, 2)}\n`);
  } else {
    const result = applyAllVpsSync(database, document);
    database.audit(
      "inventory.all-vps.synced",
      "source",
      "all-vps",
      `同步 all-vps 清单：新增 ${result.summary.created}，更新 ${result.summary.updated}，未变更 ${result.summary.unchanged}`,
      "info",
      { digest: result.source.digest, ...result.summary }
    );
    process.stdout.write(`${JSON.stringify({ ...result, changes: result.changes.map(({ server: _server, ...change }) => change) }, null, 2)}\n`);
  }
} finally {
  database.close();
}
