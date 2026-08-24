import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { envSchema, EnvConfig } from "./env.schema";

@Injectable()
export class AppConfig {
  readonly env: EnvConfig;

  constructor(configService: ConfigService) {
    const raw = {
      NODE_ENV: configService.get("NODE_ENV"),
      PORT: configService.get("PORT"),
      LOG_LEVEL: configService.get("LOG_LEVEL"),
      DATABASE_URL: configService.get("DATABASE_URL"),
      BITRIX24_WEBHOOK_BASE_URL: configService.get("BITRIX24_WEBHOOK_BASE_URL"),
      BITRIX24_DEFAULT_RESPONSIBLE_ID: configService.get("BITRIX24_DEFAULT_RESPONSIBLE_ID"),
      BITRIX24_LEAD_INITIAL_STATUS: configService.get("BITRIX24_LEAD_INITIAL_STATUS"),
      VENDOR_IDS: configService.get("VENDOR_IDS"),
      WAZZUP_WEBHOOK_ID: configService.get("WAZZUP_WEBHOOK_ID"),
      WAZZUP_WEBHOOK_BEARER_TOKEN: configService.get("WAZZUP_WEBHOOK_BEARER_TOKEN"),
      STORE_MESSAGE_BODY: configService.get("STORE_MESSAGE_BODY"),
      EVENT_RETENTION_DAYS: configService.get("EVENT_RETENTION_DAYS"),
      MAX_WEBHOOK_BODY_BYTES: configService.get("MAX_WEBHOOK_BODY_BYTES"),
      JOB_MAX_ATTEMPTS: configService.get("JOB_MAX_ATTEMPTS"),
      WAZZUP_API_KEY: configService.get("WAZZUP_API_KEY"),
      BOT_INTERNAL_BASE_URL: configService.get("BOT_INTERNAL_BASE_URL"),
      ORCHESTRATOR_SHARED_SECRET: configService.get("ORCHESTRATOR_SHARED_SECRET"),
    };

    const parsed = envSchema.parse(raw);
    this.env = parsed;
  }

  get vendorIds(): number[] {
    return this.env.VENDOR_IDS.split(",").map((id) => parseInt(id.trim(), 10));
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === "production";
  }
}
