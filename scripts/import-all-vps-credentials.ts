import { importAllVpsCredentials } from "../server/credential-import.js";
import { GatewayDatabase } from "../server/db.js";

const supportedArguments = new Set(["--dry-run"]);
const unsupported = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupported.length) {
  throw new Error(`不支持的参数：${unsupported.join(" ")}。可用参数：--dry-run`);
}

const database = new GatewayDatabase();
try {
  const result = importAllVpsCredentials(database, { dryRun: process.argv.includes("--dry-run") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  database.close();
}
