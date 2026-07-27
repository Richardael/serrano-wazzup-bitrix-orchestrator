import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
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

export const catalogProducts = pgTable("catalog_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  normalizedName: varchar("normalized_name", { length: 256 }).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  shortDescription: text("short_description"),
  searchText: text("search_text").notNull(),
  aliases: jsonb("aliases").notNull().default("[]"),
  configurations: jsonb("configurations").notNull().default("[]"),
  materials: jsonb("materials").notNull().default("[]"),
  finishes: jsonb("finishes").notNull().default("[]"),
  sizes: jsonb("sizes").notNull().default("[]"),
  seatOptions: jsonb("seat_options").notNull().default("[]"),
  sourcePages: jsonb("source_pages").notNull().default("[]"),
  keywords: jsonb("keywords").notNull().default("[]"),
  isActive: boolean("is_active").notNull().default(true),
  needsReview: boolean("needs_review").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_catalog_name").on(table.normalizedName),
  index("idx_catalog_category").on(table.category),
  index("idx_catalog_active").on(table.isActive),
]);

export const catalogProductImages = pgTable("catalog_product_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => catalogProducts.id),
  sourcePage: integer("source_page"),
  storagePath: varchar("storage_path", { length: 512 }),
  publicUrl: varchar("public_url", { length: 1024 }),
  altText: text("alt_text"),
  sortOrder: integer("sort_order").notNull().default(0),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationStates = pgTable("conversation_states", {
  chatId: varchar("chat_id", { length: 64 }).primaryKey(),
  normalizedPhone: varchar("normalized_phone", { length: 16 }).notNull(),
  leadId: varchar("lead_id", { length: 32 }),
  assignedVendorId: integer("assigned_vendor_id"),
  stage: varchar("stage", { length: 64 }).notNull().default("GREETING"),
  lastIntent: varchar("last_intent", { length: 64 }),
  summary: text("summary").notNull().default(""),
  facts: jsonb("facts").notNull().default("{}"),
  selectedProductIds: jsonb("selected_product_ids").notNull().default("[]"),
  rejectedProductIds: jsonb("rejected_product_ids").notNull().default("[]"),
  pendingQuestion: varchar("pending_question", { length: 512 }),
  handoffRequested: boolean("handoff_requested").notNull().default(false),
  handoffReason: varchar("handoff_reason", { length: 128 }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_conv_activity").on(table.lastActivityAt),
  index("idx_conv_phone").on(table.normalizedPhone),
]);
