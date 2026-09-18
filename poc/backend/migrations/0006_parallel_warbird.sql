CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "content_admin_title_trgm_idx" ON "content" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "content_admin_slug_trgm_idx" ON "content" USING gin ("slug" gin_trgm_ops);
