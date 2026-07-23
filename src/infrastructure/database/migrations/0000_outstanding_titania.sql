CREATE TABLE "assignment_counter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "integration_events" (
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
--> statement-breakpoint
CREATE TABLE "phone_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_phone" varchar(16) NOT NULL,
	"phone_country" varchar(4),
	"active_lead_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phone_links_normalized_phone_unique" UNIQUE("normalized_phone")
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."integration_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_event_id_integration_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."integration_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_event" ON "integration_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_payload_dedup" ON "integration_events" USING btree ("provider","payload_hash","received_at");