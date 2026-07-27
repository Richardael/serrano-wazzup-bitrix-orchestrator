CREATE TABLE "catalog_product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_page" integer,
	"storage_path" varchar(512),
	"public_url" varchar(1024),
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(256) NOT NULL,
	"name" varchar(256) NOT NULL,
	"normalized_name" varchar(256) NOT NULL,
	"category" varchar(128) NOT NULL,
	"short_description" text,
	"search_text" text NOT NULL,
	"aliases" jsonb DEFAULT '[]' NOT NULL,
	"configurations" jsonb DEFAULT '[]' NOT NULL,
	"materials" jsonb DEFAULT '[]' NOT NULL,
	"finishes" jsonb DEFAULT '[]' NOT NULL,
	"sizes" jsonb DEFAULT '[]' NOT NULL,
	"seat_options" jsonb DEFAULT '[]' NOT NULL,
	"source_pages" jsonb DEFAULT '[]' NOT NULL,
	"keywords" jsonb DEFAULT '[]' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "conversation_states" (
	"chat_id" varchar(64) PRIMARY KEY NOT NULL,
	"normalized_phone" varchar(16) NOT NULL,
	"lead_id" varchar(32),
	"assigned_vendor_id" integer,
	"stage" varchar(64) DEFAULT 'GREETING' NOT NULL,
	"last_intent" varchar(64),
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '{}' NOT NULL,
	"selected_product_ids" jsonb DEFAULT '[]' NOT NULL,
	"rejected_product_ids" jsonb DEFAULT '[]' NOT NULL,
	"pending_question" varchar(512),
	"handoff_requested" boolean DEFAULT false NOT NULL,
	"handoff_reason" varchar(128),
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_product_images" ADD CONSTRAINT "catalog_product_images_product_id_catalog_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_catalog_name" ON "catalog_products" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "idx_catalog_category" ON "catalog_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_catalog_active" ON "catalog_products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_conv_activity" ON "conversation_states" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "idx_conv_phone" ON "conversation_states" USING btree ("normalized_phone");