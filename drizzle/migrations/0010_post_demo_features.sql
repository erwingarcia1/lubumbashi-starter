CREATE TYPE "app"."commission_basis" AS ENUM('collection_percent', 'registration_fixed');--> statement-breakpoint
CREATE TYPE "app"."commission_line_kind" AS ENUM('collection', 'reversal', 'registration');--> statement-breakpoint
CREATE TYPE "app"."commission_statement_status" AS ENUM('draft', 'approved', 'paid');--> statement-breakpoint
CREATE TYPE "app"."position_source" AS ENUM('ping', 'census', 'payment');--> statement-breakpoint
CREATE TABLE "app"."commission_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" "app"."commission_line_kind" NOT NULL,
	"rule_id" uuid,
	"payment_id" uuid,
	"taxpayer_id" uuid,
	"business_date" date NOT NULL,
	"base_fc" integer DEFAULT 0 NOT NULL,
	"rate_bp" integer DEFAULT 0 NOT NULL,
	"amount_fc" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"basis" "app"."commission_basis" NOT NULL,
	"rate_bp" integer DEFAULT 0 NOT NULL,
	"amount_fc" integer DEFAULT 0 NOT NULL,
	"tax_rule_id" uuid,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_code_from_uniq" UNIQUE("code","effective_from"),
	CONSTRAINT "commission_rules_rate_range" CHECK ("app"."commission_rules"."rate_bp" >= 0 and "app"."commission_rules"."rate_bp" <= 10000),
	CONSTRAINT "commission_rules_amount_nonneg" CHECK ("app"."commission_rules"."amount_fc" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."commission_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" "app"."commission_statement_status" DEFAULT 'draft' NOT NULL,
	"collections_count" integer DEFAULT 0 NOT NULL,
	"collected_fc" integer DEFAULT 0 NOT NULL,
	"collection_commission_fc" integer DEFAULT 0 NOT NULL,
	"registrations_count" integer DEFAULT 0 NOT NULL,
	"registration_commission_fc" integer DEFAULT 0 NOT NULL,
	"total_fc" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_admin_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_by_admin_id" uuid,
	"paid_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_agent_period_uniq" UNIQUE("agent_id","period"),
	CONSTRAINT "commission_statements_period_format" CHECK ("app"."commission_statements"."period" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "app"."agent_positions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."agent_positions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_id" uuid NOT NULL,
	"device_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"location" geometry(point) NOT NULL,
	"accuracy_m" integer,
	"source" "app"."position_source" DEFAULT 'ping' NOT NULL,
	"business_date" date GENERATED ALWAYS AS (util.business_date(recorded_at)) STORED
);
--> statement-breakpoint
ALTER TABLE "app"."zones" ADD COLUMN "centroid" geometry(point);--> statement-breakpoint
ALTER TABLE "app"."zones" ADD COLUMN "radius_m" integer;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD COLUMN "invoice_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD COLUMN "invoice_issued_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."commission_lines" ADD CONSTRAINT "commission_lines_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "app"."commission_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_lines" ADD CONSTRAINT "commission_lines_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "app"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_lines" ADD CONSTRAINT "commission_lines_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_lines" ADD CONSTRAINT "commission_lines_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_rules" ADD CONSTRAINT "commission_rules_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "app"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_rules" ADD CONSTRAINT "commission_rules_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_statements" ADD CONSTRAINT "commission_statements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_statements" ADD CONSTRAINT "commission_statements_approved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("approved_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."commission_statements" ADD CONSTRAINT "commission_statements_paid_by_admin_id_admin_users_id_fk" FOREIGN KEY ("paid_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_positions" ADD CONSTRAINT "agent_positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_positions" ADD CONSTRAINT "agent_positions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "app"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_lines_statement_idx" ON "app"."commission_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "commission_lines_payment_idx" ON "app"."commission_lines" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "commission_statements_period_idx" ON "app"."commission_statements" USING btree ("period");--> statement-breakpoint
CREATE INDEX "agent_positions_agent_time_idx" ON "app"."agent_positions" USING btree ("agent_id","recorded_at");--> statement-breakpoint
CREATE INDEX "agent_positions_business_date_idx" ON "app"."agent_positions" USING btree ("business_date");--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_invoice_issued_by_admin_id_admin_users_id_fk" FOREIGN KEY ("invoice_issued_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;