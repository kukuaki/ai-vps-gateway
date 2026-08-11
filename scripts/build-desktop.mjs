import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectDirectory, "dist-electron");

mkdirSync(outputDirectory, { recursive: true });

const common = {
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  logLevel: "info"
};

await Promise.all([
  build({
    ...common,
    entryPoints: [resolve(projectDirectory, "desktop/main.ts")],
    outfile: resolve(outputDirectory, "main.cjs"),
    external: ["electron"],
    packages: "external"
  }),
  build({
    ...common,
    entryPoints: [resolve(projectDirectory, "desktop/preload.ts")],
    outfile: resolve(outputDirectory, "preload.cjs"),
    external: ["electron"],
    packages: "external"
  }),
  build({
    ...common,
    entryPoints: [resolve(projectDirectory, "mcp/index.ts")],
    outfile: resolve(outputDirectory, "mcp.cjs"),
    packages: "bundle"
  })
]);
