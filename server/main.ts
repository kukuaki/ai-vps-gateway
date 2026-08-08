import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { GatewayDatabase } from "./db.js";
import { probeServer } from "./probes.js";
import type { CreateServerInput, HealthCheckConfig, HealthCheckKind, UpdateServerInput } from "./types.js";

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
const idParamsSchema = z.object({ id: z.string().uuid() });

function validationError(reply: { code: (status: number) => { send: (payload: unknown) => unknown } }, issues: z.ZodIssue[]): unknown {
  return reply.code(400).send({ error: "ValidationError", message: "请求参数无效", issues });
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

export async function buildApp(database = new GatewayDatabase()): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === "production" });
  const intervalMs = Math.min(Math.max(Number(process.env.ALLVPS_PROBE_INTERVAL_MS ?? 30_000), 10_000), 300_000);
  const scheduler = new ProbeScheduler(database, intervalMs);

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

  app.get("/api/audit", () => ({ events: database.recentAudit() }));

  const distDirectory = resolve(process.cwd(), "dist");
  if (existsSync(distDirectory)) {
    await app.register(fastifyStatic, { root: distDirectory, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "NotFound" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onReady", () => scheduler.start());
  app.addHook("onClose", () => {
    scheduler.stop();
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
