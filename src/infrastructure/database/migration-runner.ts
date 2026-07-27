import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import postgres from "postgres";
import { AppConfig } from "../config/app.config";

@Injectable()
export class MigrationRunner implements OnModuleInit {
  private readonly logger = new Logger(MigrationRunner.name);

  constructor(private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    try {
      const sql = postgres(this.config.env.DATABASE_URL, { max: 1 });

      await sql`
        CREATE TABLE IF NOT EXISTS drizzle_migrations (
          name VARCHAR(256) PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      const migrationSql = `
        CREATE TABLE IF NOT EXISTS "assignment_counter" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "current_index" integer DEFAULT 0 NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "integration_events" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "provider" varchar(32) NOT NULL,
          "provider_event_id" varchar(256),
          "event_type" varchar(64) NOT NULL,
          "payload_hash" varchar(128) NOT NULL,
          "sanitized_payload" jsonb,
          "status" varchar(32) DEFAULT 'RECEIVED' NOT NULL,
          "attempts" integer DEFAULT 0 NOT NULL,
          "correlation_id" uuid NOT NULL,
          "received_at" timestamp with time zone DEFAULT now() NOT NULL,
          "processing_started_at" timestamp with time zone,
          "processed_at" timestamp with time zone,
          "next_retry_at" timestamp with time zone,
          "error_code" varchar(64),
          "error_message" text
        );

        CREATE TABLE IF NOT EXISTS "integration_actions" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "event_id" uuid NOT NULL REFERENCES "integration_events"("id"),
          "action_type" varchar(64) NOT NULL,
          "external_entity_type" varchar(32) NOT NULL,
          "external_entity_id" varchar(32),
          "request_hash" varchar(128) NOT NULL,
          "status" varchar(32) DEFAULT 'PENDING' NOT NULL,
          "attempts" integer DEFAULT 0 NOT NULL,
          "started_at" timestamp with time zone,
          "completed_at" timestamp with time zone,
          "error_code" varchar(64),
          "error_message" text
        );

        CREATE TABLE IF NOT EXISTS "phone_links" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "normalized_phone" varchar(16) NOT NULL UNIQUE,
          "phone_country" varchar(4),
          "active_lead_ids" jsonb DEFAULT '[]' NOT NULL,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "processing_jobs" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "event_id" uuid NOT NULL REFERENCES "integration_events"("id"),
          "job_type" varchar(64) NOT NULL,
          "payload" jsonb NOT NULL,
          "status" varchar(32) DEFAULT 'PENDING' NOT NULL,
          "priority" integer DEFAULT 0 NOT NULL,
          "attempts" integer DEFAULT 0 NOT NULL,
          "max_attempts" integer DEFAULT 5 NOT NULL,
          "run_after" timestamp with time zone DEFAULT now() NOT NULL,
          "locked_at" timestamp with time zone,
          "locked_by" varchar(64),
          "created_at" timestamp with time zone DEFAULT now() NOT NULL,
          "completed_at" timestamp with time zone,
          "error_message" text
        );

        CREATE INDEX IF NOT EXISTS "uq_provider_event" ON "integration_events" ("provider","provider_event_id");
        CREATE INDEX IF NOT EXISTS "idx_payload_dedup" ON "integration_events" ("provider","payload_hash","received_at");
      `;

      await sql.unsafe(migrationSql);

      await sql.unsafe(`INSERT INTO "assignment_counter" ("id", "current_index", "updated_at") 
        SELECT gen_random_uuid(), 0, now() 
        WHERE NOT EXISTS (SELECT 1 FROM "assignment_counter")`);

      await sql.end();
      this.logger.log("Database migrations applied successfully");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Migration failed (non-fatal): ${msg}`);
    }
  }
}
