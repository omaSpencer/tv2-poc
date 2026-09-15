CREATE TABLE "content" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text,
	"title" text NOT NULL,
	"summary" text,
	"category" text,
	"media_asset_id" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "content_slug_unique" UNIQUE("slug"),
	CONSTRAINT "content_title_length" CHECK (char_length("content"."title") between 1 and 200),
	CONSTRAINT "content_slug_shape" CHECK ("content"."slug" is null or ("content"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("content"."slug") <= 80)),
	CONSTRAINT "content_summary_length" CHECK ("content"."summary" is null or char_length("content"."summary") between 1 and 500),
	CONSTRAINT "content_category_allowed" CHECK ("content"."category" is null or category in ('film', 'sorozat', 'hir', 'sport', 'szorakozas', 'egyeb')),
	CONSTRAINT "content_media_asset_length" CHECK ("content"."media_asset_id" is null or char_length("content"."media_asset_id") between 1 and 128),
	CONSTRAINT "content_tag_count" CHECK (coalesce(array_length("content"."tags", 1), 0) <= 20),
	CONSTRAINT "content_status_allowed" CHECK (status in ('draft', 'published', 'withdrawn')),
	CONSTRAINT "content_version_positive" CHECK ("content"."version" >= 1),
	CONSTRAINT "content_actor_present" CHECK (char_length("content"."created_by") between 1 and 200 and char_length("content"."updated_by") between 1 and 200),
	CONSTRAINT "content_published_minimum" CHECK ("content"."status" <> 'published' or ("content"."slug" is not null and "content"."summary" is not null and "content"."category" is not null and "content"."media_asset_id" is not null and "content"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "content_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content_id" uuid NOT NULL,
	"content_version" integer NOT NULL,
	"action" text NOT NULL,
	"actor_sub" text NOT NULL,
	"actor_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "content_audit_content_version_unique" UNIQUE("content_id","content_version"),
	CONSTRAINT "content_audit_action_allowed" CHECK (action in ('created', 'updated', 'published', 'withdrawn')),
	CONSTRAINT "content_audit_version_positive" CHECK ("content_audit"."content_version" >= 1),
	CONSTRAINT "content_audit_actor_present" CHECK (char_length("content_audit"."actor_sub") between 1 and 200),
	CONSTRAINT "content_audit_correlation_shape" CHECK ("content_audit"."correlation_id" ~ '^[A-Za-z0-9._-]{1,128}$')
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"correlation_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "outbox_event_aggregate_version_unique" UNIQUE("aggregate_id","aggregate_version"),
	CONSTRAINT "outbox_event_schema_version" CHECK ("outbox_event"."schema_version" = 1),
	CONSTRAINT "outbox_event_type_allowed" CHECK (event_type in ('content.published', 'content.withdrawn')),
	CONSTRAINT "outbox_event_version_positive" CHECK ("outbox_event"."aggregate_version" >= 1),
	CONSTRAINT "outbox_event_correlation_shape" CHECK ("outbox_event"."correlation_id" ~ '^[A-Za-z0-9._-]{1,128}$'),
	CONSTRAINT "outbox_event_payload_pair" CHECK (("outbox_event"."event_type" = 'content.published' and "outbox_event"."payload" ->> 'status' = 'published') or ("outbox_event"."event_type" = 'content.withdrawn' and "outbox_event"."payload" ->> 'status' = 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "content_audit" ADD CONSTRAINT "content_audit_content_id_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_aggregate_id_content_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."content"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("occurred_at","event_id") WHERE "outbox_event"."delivered_at" is null;