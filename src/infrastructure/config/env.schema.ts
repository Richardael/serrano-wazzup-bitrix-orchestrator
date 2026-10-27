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
  WAZZUP_API_KEY: z.string().optional().default(""),
  BOT_INTERNAL_BASE_URL: z.string().url().optional(),
  ORCHESTRATOR_SHARED_SECRET: z.string().min(16).optional(),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  AUTOMATED_CHATBOT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CATALOG_CHATBOT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CATALOG_CHATBOT_SHADOW_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Cierra como duplicado el lead que crea la integracion nativa de Wazzup cuando
  // el orquestador ya tiene el suyo. Se puede apagar sin redeploy de codigo.
  WAZZUP_NATIVE_DEDUP_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CATALOG_HANDOFF_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CATALOG_IMAGES_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Notificaciones salientes (AppSB) desde el MISMO numero que atiende leads. AppSB
  // registra cada envio; durante la ventana, la respuesta del cliente NO entra al
  // flujo de leads (ni bot ni lead nuevo). Sin secreto el registro queda cerrado.
  NOTIFICATION_API_SECRET: z.string().min(16).optional(),
  NOTIFICATION_REPLY_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  NOTIFICATION_ROUTING_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Cuando un cliente con lead activo escribe por WhatsApp, crea en el lead una
  // actividad pendiente para que la tarjeta del Kanban muestre el contador. Se
  // puede apagar sin redeploy de codigo.
  CLIENT_REPLY_ALERT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  // Etapas del lead en las que se avisa (STATUS_ID separados por coma). Por
  // defecto, de "Conversacion Inicial" en adelante: Conversacion Inicial,
  // Informacion Adicional y Calificacion Preliminar. La campana de reactivacion
  // (UC_G1C4G0) se puede sumar aqui sin tocar codigo.
  CLIENT_REPLY_ALERT_STATUSES: z.string().default("IN_PROCESS,ON_HOLD,RESTORED"),
  CONVERSATION_STATE_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
}).refine(
  (env) => Boolean(env.BOT_INTERNAL_BASE_URL) === Boolean(env.ORCHESTRATOR_SHARED_SECRET),
  "BOT_INTERNAL_BASE_URL and ORCHESTRATOR_SHARED_SECRET must be configured together",
);

export type EnvConfig = z.infer<typeof envSchema>;
