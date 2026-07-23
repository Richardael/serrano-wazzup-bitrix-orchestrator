import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: varchar("provider", { length: 32 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 256 }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 128 }).notNull(),
    sanitizedPayload: jsonb("sanitized_payload"),
    status: varchar("status", { length: 32 }).notNull().default("RECEIVED"),
    attempts: integer("attempts").notNull().default(0),
    correlationId: uuid("correlation_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
  },
  (table) => [
    uniqueIndex("uq_provider_event").on(table.provider, table.providerEventId),
    index("idx_payload_dedup").on(table.provider, table.payloadHash, table.receivedAt),
  ],
);

export const phoneLinks = pgTable("phone_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  normalizedPhone: varchar("normalized_phone", { length: 16 }).notNull().unique(),
  phoneCountry: varchar("phone_country", { length: 4 }),
  activeLeadIds: jsonb("active_lead_ids").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assignmentCounter = pgTable("assignment_counter", {
  id: uuid("id").primaryKey().defaultRandom(),
  currentIndex: integer("current_index").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationActions = pgTable("integration_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => integrationEvents.id),
  actionType: varchar("action_type", { length: 64 }).notNull(),
  externalEntityType: varchar("external_entity_type", { length: 32 }).notNull(),
  externalEntityId: varchar("external_entity_id", { length: 32 }),
  requestHash: varchar("request_hash", { length: 128 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorCode: varchar("error_code", { length: 64 }),
  errorMessage: text("error_message"),
});

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => integrationEvents.id),
  jobType: varchar("job_type", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("PENDING"),
  priority: integer("priority").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: varchar("locked_by", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});
