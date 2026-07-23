import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().url().min(1),
  BITRIX24_WEBHOOK_BASE_URL: z.string().url().min(1),
  BITRIX24_DEFAULT_RESPONSIBLE_ID: z.coerce.number().int().positive().optional(),
  BITRIX24_LEAD_INITIAL_STATUS: z.string().default("NEW"),
  VENDOR_IDS: z.string().min(1),
  WAZZUP_WEBHOOK_ID: z.string().min(1),
  WAZZUP_WEBHOOK_BEARER_TOKEN: z.string().min(16),
  STORE_MESSAGE_BODY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_WEBHOOK_BODY_BYTES: z.coerce.number().int().positive().default(1048576),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export type EnvConfig = z.infer<typeof envSchema>;
