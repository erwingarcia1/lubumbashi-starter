CREATE TABLE "app"."invoice_counters" (
	"yymm" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD COLUMN "invoice_no" text;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD COLUMN "invoice_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "obligations_invoice_no_uniq" ON "app"."obligations" USING btree ("invoice_no");