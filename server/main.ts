import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { applyAllVpsSync, defaultAllVpsSourcePaths, loadAllVpsDocument, previewAllVpsSync, type AllVpsSourcePaths } from "./all-vps.js";
import { GatewayDatabase } from "./db.js";
import { GatewayOperationError, GatewayOperations, type GatewayOperationOptions } from "./operations.js";
import { SshExecutor } from "./ssh.js";
import { probeServer } from "./probes.js";
import type {
  CreateProjectInput,
  CreateServerInput,
  HealthCheckConfig,
  HealthCheckKind,
  ProjectServiceInput,
  UpdateProjectInput,
  UpdateServerInput
} from "./types.js";

const hostSchema = z
  .string()
  .trim()
  .min(1, "地址不能为空")
  .max(253, "地址过长")
  .refine((value) => !/[\s/]/.test(value), "地址不能包含空格或路径")
  .refine((value) => !value.startsWith("-"), "地址不能以连字符开头");

const sshUserSchema = z
  .string()
  .trim()
  .regex(/^[a-z_][a-z0-9_-]{0,31}$/i, "SSH 用户只能包含字母、数字、下划线和连字符");

const credentialRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((value) => !/[\\/]/.test(value), "凭据引用不能包含路径分隔符");

const healthCheckSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(["http", "tcp"]),
    enabled: z.boolean().optional(),
    config: z.object({
      url: z.string().url().optional(),
      host: hostSchema.optional(),
      port: z.number().int().min(1).max(65535).optional(),
      expectedStatusCodes: z.array(z.number().int().min(100).max(599)).max(12).optional(),
      timeoutMs: z.number().int().min(250).max(10_000).optional()
    })
  })
  .superRefine((value, context) => {
    if (value.kind === "http" && !value.config.url) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["config", "url"], message: "HTTP 检查需要 URL" });
    }
    if (value.kind === "tcp" && !value.config.port) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["config", "port"], message: "TCP 检查需要端口" });
    }
  });

const createServerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  address: hostSchema,
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: sshUserSchema.default("root"),
  credentialRef: credentialRefSchema.nullable().optional(),
  role: z.string().trim().max(100).default(""),
  environment: z.string().trim().min(1).max(40).default("production"),
  accessUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
  maintenance: z.boolean().default(false),
  healthChecks: z.array(healthCheckSchema).max(20).default([])
});

const updateServerSchema = createServerSchema.partial();
const projectRunbookSchema = z.object({
  overview: z.string().trim().max(12_000).default(""),
  deployment: z.string().trim().max(12_000).default(""),
  verification: z.string().trim().max(12_000).default(""),
  troubleshooting: z.string().trim().max(12_000).default(""),
  guardrails: z.string().trim().max(12_000).default("")
});
const projectServerSchema = z.object({
  serverId: z.string().uuid(),
  role: z.string().trim().max(80).default("")
});
const projectServiceSchema = z.object({
  serverId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  manager: z.enum(["docker", "systemd", "process", "external"]),
  identifier: z.string().trim().min(1).max(160).refine((value) => !/[\r\n]/.test(value), "服务标识不能包含换行"),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  accessUrl: z.string().url().nullable().optional(),
  critical: z.boolean().default(false),
  notes: z.string().trim().max(4_000).default("")
});
const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2_000).default(""),
    repositoryUrl: z.string().url().nullable().optional(),
    repositoryPath: z.string().trim().min(1).max(320).nullable().optional(),
    runbook: projectRunbookSchema.default({ overview: "", deployment: "", verification: "", troubleshooting: "", guardrails: "" }),
    servers: z.array(projectServerSchema).max(30).default([]),
    services: z.array(projectServiceSchema).max(100).default([])
  })
  .superRefine((value, context) => {
    const serverIds = new Set<string>();
    value.servers.forEach((server, index) => {
      if (serverIds.has(server.serverId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["servers", index, "serverId"], message: "同一 VPS 只能关联一次" });
      }
      serverIds.add(server.serverId);
    });
    value.services.forEach((service, index) => {
      if (!serverIds.has(service.serverId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["services", index, "serverId"], message: "服务必须关联到项目内的一台 VPS" });
      }
    });
  });
const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2_000).optional(),
  repositoryUrl: z.string().url().nullable().optional(),
  repositoryPath: z.string().trim().min(1).max(320).nullable().optional(),
  runbook: projectRunbookSchema.optional(),
  servers: z.array(projectServerSchema).max(30).optional(),
  services: z.array(projectServiceSchema).max(100).optional()
});
const idParamsSchema = z.object({ id: z.string().uuid() });
const allVpsSyncSchema = z.object({
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional()
});
const openSessionSchema = z.object({
  serverId: z.string().uuid(),
  requester: z.string().trim().max(120).optional()
});
const commandSchema = z.object({
  command: z.string().min(1, "命令不能为空").max(20_000, "命令过长"),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional()
});
const sessionCloseSchema = z.object({ reason: z.string().trim().min(1).max(120).optional() });
const metricsSchema = z.object({ sessionId: z.string().uuid().optional() });
export const DEFAULT_ROOT_ACCESS_DURATION_MS = 8 * 60 * 60_000;
const emergencyRootSchema = z.object({
  durationMs: z.number().int().min(5 * 60_000).max(DEFAULT_ROOT_ACCESS_DURATION_MS).default(DEFAULT_ROOT_ACCESS_DURATION_MS)
});

function validationError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, issues: z.ZodIssue[]): unknown {
  return reply.code(400).send({ error: "ValidationError", message: "请求参数无效", issues });
}

function importSourceError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  return reply.code(422).send({
    error: "ImportSourceError",
    message: error instanceof Error ? error.message : "无法读取 all-vps 文档"
  });
}

function projectResourceError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  return reply.code(400).send({
    error: "ProjectResourceError",
    message: error instanceof Error ? error.message : "项目关联资源无效"
  });
}

function operationError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, error: unknown): unknown {
  if (error instanceof GatewayOperationError) {
    return reply.code(error.statusCode).send({ error: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) });
  }
  return reply.code(500).send({ error: "OperationError", message: error instanceof Error ? error.message : "网关操作失败" });
}

function normalizeHealthChecks(
  checks: z.infer<typeof healthCheckSchema>[]
): CreateServerInput["healthChecks"] {
  return checks.map((check) => ({
    name: check.name,
    kind: check.kind as HealthCheckKind,
    enabled: check.enabled,
    config: check.config as HealthCheckConfig
  }));
}

function normalizeCreateInput(input: z.infer<typeof createServerSchema>): CreateServerInput {
  return {
    ...input,
    healthChecks: normalizeHealthChecks(input.healthChecks)
  };
}

function normalizeUpdateInput(input: z.infer<typeof updateServerSchema>): UpdateServerInput {
  const { healthChecks, ...rest } = input;
  return {
    ...rest,
    ...(healthChecks === undefined ? {} : { healthChecks: normalizeHealthChecks(healthChecks) })
  };
}

function normalizeProjectServices(services: z.infer<typeof projectServiceSchema>[]): ProjectServiceInput[] {
  return services.map((service) => ({
    serverId: service.serverId,
    name: service.name,
    manager: service.manager,
    identifier: service.identifier,
    port: service.port,
    accessUrl: service.accessUrl,
    critical: service.critical,
    notes: service.notes
  }));
}

function normalizeCreateProjectInput(input: z.infer<typeof createProjectSchema>): CreateProjectInput {
  return {
    ...input,
    servers: input.servers.map((server) => ({ serverId: server.serverId, role: server.role })),
    services: normalizeProjectServices(input.services)
  };
}

function normalizeUpdateProjectInput(input: z.infer<typeof updateProjectSchema>): UpdateProjectInput {
  const { servers, services, ...rest } = input;
  return {
    ...rest,
    ...(servers === undefined ? {} : { servers: servers.map((server) => ({ serverId: server.serverId, role: server.role })) }),
    ...(services === undefined ? {} : { services: normalizeProjectServices(services) })
  };
}

class ProbeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly database: GatewayDatabase, private readonly intervalMs: number) {}

  start(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const server of this.database.listServers()) {
        await probeServer(this.database, server);
      }
    } finally {
      this.running = false;
    }
  }
}

export interface GatewayOptions {
  allVpsSourcePaths?: AllVpsSourcePaths;
  operationOptions?: GatewayOperationOptions;
}

export async function buildApp(database = new GatewayDatabase(), options: GatewayOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" });
  const intervalMs = Math.min(Math.max(Number(process.env.ALLVPS_PROBE_INTERVAL_MS ?? 30_000), 10_000), 300_000);
  const scheduler = new ProbeScheduler(database, intervalMs);
  const operations = new GatewayOperations(database, options.operationOptions ?? {
    idleTimeoutMs: Number(process.env.ALLVPS_SESSION_IDLE_MS ?? 30 * 60 * 1_000),
    maxSessionDurationMs: Number(process.env.ALLVPS_SESSION_MAX_MS ?? 8 * 60 * 60 * 1_000),
    sweepIntervalMs: Number(process.env.ALLVPS_SESSION_SWEEP_MS ?? 30_000),
    commandRetentionMs: Number(process.env.ALLVPS_COMMAND_RETENTION_MS ?? 90 * 24 * 60 * 60 * 1_000),
    sshExecutor: new SshExecutor()
  });
  const allVpsSourcePaths = options.allVpsSourcePaths ?? defaultAllVpsSourcePaths();

  await app.register(cors, {
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "POST", "PATCH"]
  });

  app.get("/api/health", () => ({ ok: true, mode: "local-only", version: "0.1.0" }));

  app.get("/api/dashboard", () => database.dashboard());

  app.get("/api/servers", () => ({ servers: database.listServers() }));

  app.get("/api/servers/:id", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const server = database.getServer(params.data.id);
    if (!server) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    return {
      server,
      events: database.recentHealthEvents(server.id),
      metric: database.latestMetric(server.id)
    };
  });

  app.post("/api/servers", (request, reply) => {
    const body = createServerSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const server = database.createServer(normalizeCreateInput(body.data));
    database.audit("server.created", "server", server.id, `新增 VPS：${server.name}`, "info", {
      address: server.address,
      sshPort: server.sshPort
    });
    return reply.code(201).send({ server });
  });

  app.patch("/api/servers/:id", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = updateServerSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    const server = database.updateServer(params.data.id, normalizeUpdateInput(body.data));
    if (!server) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    database.audit("server.updated", "server", server.id, `更新 VPS：${server.name}`);
    return { server };
  });

  app.post("/api/servers/:id/probe", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const server = database.getServer(params.data.id);
    if (!server) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    const summary = await probeServer(database, server);
    database.audit("server.probed", "server", server.id, `手动测活：${server.name}`, summary.status === "healthy" ? "info" : "warning", {
      status: summary.status
    });
    return { summary, server: database.getServer(server.id) };
  });

  app.post("/api/servers/:id/metrics", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = metricsSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const metric = await operations.collectMetrics(params.data.id, body.data.sessionId, "webui:metrics");
      return { metric };
    } catch (error) {
      return operationError(reply, error);
    }
  });

  app.post("/api/servers/:id/emergency-root", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = emergencyRootSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    const server = database.getServer(params.data.id);
    if (!server) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    if (server.sshUser !== "root") return reply.code(409).send({ error: "EmergencyRootNotRequired", message: "这台 VPS 使用的不是 root SSH 登录" });
    const updated = database.grantEmergencyRoot(server.id, body.data.durationMs);
    if (!updated) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    database.audit("server.emergency_root.granted", "server", server.id, `开启紧急 root 救援：${server.name}`, "critical", {
      durationMs: body.data.durationMs,
      until: updated.emergencyRootUntil
    });
    return { server: updated };
  });

  app.post("/api/servers/:id/emergency-root/revoke", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    try {
      return { server: operations.revokeEmergencyRoot(params.data.id) };
    } catch (error) {
      return operationError(reply, error);
    }
  });

  app.post("/api/servers/:id/archive", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const server = database.getServer(params.data.id);
    if (!server) return reply.code(404).send({ error: "NotFound", message: "未找到 VPS" });
    const archived = database.archiveServer(server.id);
    if (!archived) return reply.code(409).send({ error: "Conflict", message: "VPS 已归档" });
    database.audit("server.archived", "server", server.id, `归档 VPS：${server.name}`, "warning");
    return { archived: true };
  });

  app.get("/api/sessions", () => ({ sessions: operations.listSessions() }));

  app.post("/api/sessions", (request, reply) => {
    const body = openSessionSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      return reply.code(201).send({ session: operations.openSession(body.data.serverId, body.data.requester) });
    } catch (error) {
      return operationError(reply, error);
    }
  });

  app.get("/api/sessions/:id", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const session = operations.getSession(params.data.id);
    if (!session) return reply.code(404).send({ error: "NotFound", message: "未找到会话" });
    return { session };
  });

  app.post("/api/sessions/:id/commands", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = commandSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const result = await operations.runCommand(params.data.id, body.data.command, body.data.timeoutMs);
      return { result, session: operations.getSession(params.data.id) };
    } catch (error) {
      return operationError(reply, error);
    }
  });

  app.post("/api/sessions/:id/close", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = sessionCloseSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      return operations.closeSession(params.data.id, body.data.reason);
    } catch (error) {
      return operationError(reply, error);
    }
  });

  app.get("/api/projects", () => ({ projects: database.listProjects() }));

  app.get("/api/projects/:id", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const project = database.getProject(params.data.id);
    if (!project) return reply.code(404).send({ error: "NotFound", message: "未找到项目" });
    return { project };
  });

  app.post("/api/projects", (request, reply) => {
    const body = createProjectSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const project = database.createProject(normalizeCreateProjectInput(body.data));
      database.audit("project.created", "project", project.id, `新增项目：${project.name}`, "info", {
        servers: project.serverCount,
        services: project.serviceCount
      });
      return reply.code(201).send({ project });
    } catch (error) {
      return projectResourceError(reply, error);
    }
  });

  app.patch("/api/projects/:id", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const body = updateProjectSchema.safeParse(request.body);
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const project = database.updateProject(params.data.id, normalizeUpdateProjectInput(body.data));
      if (!project) return reply.code(404).send({ error: "NotFound", message: "未找到项目" });
      database.audit("project.updated", "project", project.id, `更新项目：${project.name}`, "info", {
        servers: project.serverCount,
        services: project.serviceCount
      });
      return { project };
    } catch (error) {
      return projectResourceError(reply, error);
    }
  });

  app.post("/api/projects/:id/archive", (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return validationError(reply, params.error.issues);
    const project = database.getProject(params.data.id);
    if (!project) return reply.code(404).send({ error: "NotFound", message: "未找到项目" });
    const archived = database.archiveProject(project.id);
    if (!archived) return reply.code(409).send({ error: "Conflict", message: "项目已归档" });
    database.audit("project.archived", "project", project.id, `归档项目：${project.name}`, "warning");
    return { archived: true };
  });

  app.get("/api/sync/all-vps/preview", (_request, reply) => {
    try {
      return previewAllVpsSync(database, loadAllVpsDocument(allVpsSourcePaths));
    } catch (error) {
      return importSourceError(reply, error);
    }
  });

  app.post("/api/sync/all-vps", (request, reply) => {
    const body = allVpsSyncSchema.safeParse(request.body ?? {});
    if (!body.success) return validationError(reply, body.error.issues);
    try {
      const document = loadAllVpsDocument(allVpsSourcePaths);
      if (body.data.sourceDigest && body.data.sourceDigest !== document.source.digest) {
        return reply.code(409).send({
          error: "ImportSourceChanged",
          message: "all-vps 文档在预览后已变更，请重新预览"
        });
      }
      const result = applyAllVpsSync(database, document);
      database.audit(
        "inventory.all-vps.synced",
        "source",
        "all-vps",
        `同步 all-vps 清单：新增 ${result.summary.created}，更新 ${result.summary.updated}，未变更 ${result.summary.unchanged}`,
        "info",
        { digest: result.source.digest, ...result.summary }
      );
      return result;
    } catch (error) {
      return importSourceError(reply, error);
    }
  });

  app.get("/api/audit", () => ({ events: database.recentAudit() }));

  const distDirectory = resolve(process.cwd(), "dist");
  if (existsSync(distDirectory)) {
    await app.register(fastifyStatic, { root: distDirectory, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "NotFound" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onReady", () => {
    scheduler.start();
    operations.start();
  });
  app.addHook("onClose", () => {
    scheduler.stop();
    operations.stop();
    database.close();
  });

  return app;
}

async function start(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4318) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
