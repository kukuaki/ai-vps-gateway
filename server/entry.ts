import { buildApp } from "./main.js";

async function start(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT ?? 4318) });
}

void start().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
