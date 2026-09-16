CREATE SEQUENCE "public"."outbox_event_outbox_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "search_index_control" (
	"index_alias" text PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"desired_worker_state" text NOT NULL,
	"run_id" uuid,
	"owner_id" text,
	"owner_heartbeat_at" timestamp with time zone,
	"worker_heartbeat_at" timestamp with time zone,
	"worker_paused_at" timestamp with time zone,
	"worker_in_flight_event_id" uuid,
	"snapshot_stream_sequence" bigint,
	"outbox_high_water" bigint,
	"catch_up_stream_sequence" bigint,
	"imported_documents" integer DEFAULT 0 NOT NULL,
	"expected_documents" integer,
	"last_error_code" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "search_index_control_alias_allowed" CHECK (index_alias in ('a', 'b')),
	CONSTRAINT "search_index_control_phase_allowed" CHECK (phase in ('ready', 'draining', 'importing', 'swapping', 'catching_up', 'verifying', 'failed')),
	CONSTRAINT "search_index_control_desired_state_allowed" CHECK (desired_worker_state in ('running', 'paused')),
	CONSTRAINT "search_index_control_imported_documents" CHECK ("search_index_control"."imported_documents" >= 0),
	CONSTRAINT "search_index_control_expected_documents" CHECK ("search_index_control"."expected_documents" is null or "search_index_control"."expected_documents" >= 0),
	CONSTRAINT "search_index_control_ready_shape" CHECK ("search_index_control"."phase" <> 'ready' or ("search_index_control"."desired_worker_state" = 'running' and "search_index_control"."completed_at" is not null and "search_index_control"."owner_id" is null))
);
--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "outbox_sequence" bigint;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "stream_sequence" bigint;--> statement-breakpoint
WITH ordered AS (
	SELECT event_id, row_number() OVER (ORDER BY occurred_at, event_id) AS sequence
	FROM outbox_event
)
UPDATE outbox_event AS target
SET outbox_sequence = ordered.sequence
FROM ordered
WHERE target.event_id = ordered.event_id;--> statement-breakpoint
SELECT setval(
	'outbox_event_outbox_sequence_seq',
	COALESCE((SELECT max(outbox_sequence) FROM outbox_event), 1),
	EXISTS (SELECT 1 FROM outbox_event)
);--> statement-breakpoint
ALTER TABLE "outbox_event"
	ALTER COLUMN "outbox_sequence" SET DEFAULT nextval('outbox_event_outbox_sequence_seq'),
	ALTER COLUMN "outbox_sequence" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_event_outbox_sequence_idx" ON "outbox_event" USING btree ("outbox_sequence");--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_outbox_sequence_unique" UNIQUE("outbox_sequence");--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_outbox_sequence_positive" CHECK ("outbox_event"."outbox_sequence" >= 1);--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_stream_sequence_pair" CHECK ("outbox_event"."stream_sequence" is null or ("outbox_event"."stream_sequence" >= 1 and "outbox_event"."delivered_at" is not null));--> statement-breakpoint
INSERT INTO search_index_control (
	index_alias, phase, desired_worker_state, updated_at, completed_at
) VALUES
	('a', 'ready', 'running', statement_timestamp(), statement_timestamp()),
	('b', 'ready', 'running', statement_timestamp(), statement_timestamp());
