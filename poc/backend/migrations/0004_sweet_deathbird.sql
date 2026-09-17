CREATE TABLE "operator_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"correlation_id" text NOT NULL,
	"reason" text NOT NULL,
	"target" jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "operator_action_kind_allowed" CHECK (kind in ('reindex', 'quarantine_replay', 'content_repair')),
	CONSTRAINT "operator_action_state_allowed" CHECK (state in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "operator_action_fingerprint_shape" CHECK ("operator_action"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operator_action_actor_present" CHECK (char_length("operator_action"."requested_by") between 1 and 200),
	CONSTRAINT "operator_action_correlation_shape" CHECK ("operator_action"."correlation_id" ~ '^[A-Za-z0-9._-]{1,128}$'),
	CONSTRAINT "operator_action_reason_length" CHECK (char_length("operator_action"."reason") between 3 and 500),
	CONSTRAINT "operator_action_terminal_shape" CHECK (("operator_action"."state" in ('queued', 'running') and "operator_action"."completed_at" is null) or ("operator_action"."state" in ('succeeded', 'failed') and "operator_action"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "operator_action_state_created_idx" ON "operator_action" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "operator_action_kind_created_idx" ON "operator_action" USING btree ("kind","created_at");