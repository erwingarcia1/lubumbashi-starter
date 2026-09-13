CREATE TYPE "app"."entity_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "app"."taxpayer_status" AS ENUM('active', 'merged', 'archived');--> statement-breakpoint
CREATE TABLE "app"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "app"."admin_users" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."tax_rule_versions" ADD COLUMN "notes_fr" text;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD COLUMN "status" "app"."entity_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD COLUMN "status" "app"."taxpayer_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "app"."settings" ADD CONSTRAINT "settings_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;