ALTER TABLE "task" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "estimated_seconds" integer;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "running_since" timestamp;