import { execFile } from "node:child_process";
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const execFileAsync = promisify(execFile);
const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePackagePath = join(projectDirectory, "package.json");

function parseArguments(argv) {
  let outputDirectory = join(projectDirectory, "release");
  let skipBuild = false;
  let keepStaging = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-build") {
      skipBuild = true;
      continue;
    }
    if (argument === "--keep-staging") {
      keepStaging = true;
      continue;
    }
    if (argument === "--output" || argument === "-o") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} 需要一个输出目录`);
      outputDirectory = resolve(projectDirectory, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      const value = argument.slice("--output=".length);
      if (!value) throw new Error("--output 需要一个输出目录");
      outputDirectory = resolve(projectDirectory, value);
      continue;
    }
    throw new Error(`不支持的参数：${argument}`);
  }

  return { outputDirectory, skipBuild, keepStaging };
}

async function run(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: projectDirectory,
      env: { ...process.env, ...options.env },
      maxBuffer: 32 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
  } catch (error) {
    if (error.stdout) process.stdout.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}

async function copyRequiredAssets(stagingDirectory) {
  const assetsDirectory = join(stagingDirectory, "assets");
  await mkdir(assetsDirectory, { recursive: true });
  for (const fileName of ["app-icon.png", "menubar-template.png"]) {
    await copyFile(join(projectDirectory, "assets", fileName), join(assetsDirectory, fileName));
  }
}

async function createStagingDirectory() {
  const stagingDirectory = await mkdtemp(join(tmpdir(), "ai-vps-gateway-desktop-staging-"));
  const packageJson = JSON.parse(await readFile(sourcePackagePath, "utf8"));

  // electron-builder rewrites the application package manifest while preparing asar.
  // The staging copy keeps that transformation away from the working tree.
  packageJson.build = {
    ...packageJson.build,
    npmRebuild: false,
    directories: {
      ...packageJson.build?.directories,
      output: "release"
    }
  };
  await writeFile(join(stagingDirectory, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await copyFile(join(projectDirectory, "package-lock.json"), join(stagingDirectory, "package-lock.json"));
  // Do not link back to the working tree: electron-builder resolves symlinks while
  // locating the npm workspace and can otherwise transform the source manifest.
  await cp(join(projectDirectory, "node_modules"), join(stagingDirectory, "node_modules"), {
    recursive: true,
    dereference: true,
    filter: (source) => !source.includes(`${join("node_modules", ".cache")}`)
  });
  await cp(join(projectDirectory, "dist"), join(stagingDirectory, "dist"), { recursive: true });
  await cp(join(projectDirectory, "dist-electron"), join(stagingDirectory, "dist-electron"), { recursive: true });
  await copyRequiredAssets(stagingDirectory);
  return stagingDirectory;
}

async function copyArtifacts(stagingDirectory, outputDirectory) {
  const stagingOutputDirectory = join(stagingDirectory, "release");
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of await readdir(stagingOutputDirectory)) {
    await cp(join(stagingOutputDirectory, entry), join(outputDirectory, entry), {
      recursive: true,
      force: true
    });
  }
}

const { outputDirectory, skipBuild, keepStaging } = parseArguments(process.argv.slice(2));
const sourcePackageBefore = await readFile(sourcePackagePath);
let stagingDirectory;

try {
  if (!skipBuild) await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:desktop"]);
  stagingDirectory = await createStagingDirectory();
  const builderPath = join(projectDirectory, "node_modules", ".bin", "electron-builder");
  await run(builderPath, ["--projectDir", stagingDirectory, "--mac", "--arm64", "--publish", "never"], {
    env: {
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    }
  });
  await copyArtifacts(stagingDirectory, outputDirectory);

  const sourcePackageAfter = await readFile(sourcePackagePath);
  if (!sourcePackageAfter.equals(sourcePackageBefore)) {
    throw new Error("electron-builder 修改了源码 package.json，已停止并保留现场供检查");
  }

  console.log(`桌面安装包已输出到：${outputDirectory}`);
} finally {
  if (stagingDirectory && !keepStaging) {
    await rm(stagingDirectory, { recursive: true, force: true });
  } else if (stagingDirectory) {
    console.log(`保留 staging 目录：${stagingDirectory}`);
  }
}
