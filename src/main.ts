import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { AppConfig } from "./infrastructure/config/app.config";
import { Logger } from "@nestjs/common";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfig);
  const logger = new Logger("Bootstrap");

  app.enableShutdownHooks();

  await app.listen(config.env.PORT, "0.0.0.0");
  logger.log(`Orchestrator listening on port ${config.env.PORT} [env=${config.env.NODE_ENV}]`);
}

bootstrap().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("Bootstrap failed:", msg);
  process.exit(1);
});
