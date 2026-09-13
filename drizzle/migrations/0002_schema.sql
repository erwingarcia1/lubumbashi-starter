CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TYPE "app"."actor_type" AS ENUM('admin', 'agent', 'system', 'taxpayer');--> statement-breakpoint
CREATE TYPE "app"."admin_role" AS ENUM('administrateur', 'maire', 'finances', 'superviseur', 'auditeur');--> statement-breakpoint
CREATE TYPE "app"."agent_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."allocation_kind" AS ENUM('principal', 'penalty');--> statement-breakpoint
CREATE TYPE "app"."complaint_status" AS ENUM('open', 'in_progress', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "app"."device_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "app"."entity_kind" AS ENUM('property', 'business', 'activity');--> statement-breakpoint
CREATE TYPE "app"."exception_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "app"."exception_type" AS ENUM('missing_at_provider', 'missing_on_platform', 'amount_mismatch', 'duplicate_at_provider', 'status_mismatch');--> statement-breakpoint
CREATE TYPE "app"."notification_channel" AS ENUM('sms', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "app"."notification_kind" AS ENUM('registration', 'payment_confirmed', 'reminder', 'receipt');--> statement-breakpoint
CREATE TYPE "app"."notification_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "app"."obligation_status" AS ENUM('due', 'partially_paid', 'paid', 'waived', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."override_kind" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TYPE "app"."payment_channel" AS ENUM('mock', 'mpesa', 'airtel', 'orange', 'tpe');--> statement-breakpoint
CREATE TYPE "app"."payment_origin" AS ENUM('agent', 'portal', 'counter');--> statement-breakpoint
CREATE TYPE "app"."payment_status" AS ENUM('initiated', 'pending', 'confirmed', 'failed', 'reversed', 'expired');--> statement-breakpoint
CREATE TYPE "app"."penalty_kind" AS ENUM('none', 'once_percent', 'once_fixed', 'monthly_percent');--> statement-breakpoint
CREATE TYPE "app"."photo_kind" AS ENUM('facade', 'other');--> statement-breakpoint
CREATE TYPE "app"."receipt_status" AS ENUM('issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "app"."reconciliation_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "app"."rule_calc_kind" AS ENUM('fixed', 'percent_of_base');--> statement-breakpoint
CREATE TYPE "app"."rule_frequency" AS ENUM('monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "app"."rule_version_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "app"."statement_match_status" AS ENUM('matched', 'unmatched');--> statement-breakpoint
CREATE TYPE "app"."taxpayer_kind" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TYPE "app"."zone_level" AS ENUM('commune', 'quartier');--> statement-breakpoint
CREATE TABLE "app"."id_counters" (
	"commune_code" text PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" "app"."zone_level" NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "app"."admin_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "app"."agent_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matricule" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"pin_hash" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"commune_id" uuid NOT NULL,
	"status" "app"."agent_status" DEFAULT 'active' NOT NULL,
	"failed_pin_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_matricule_unique" UNIQUE("matricule")
);
--> statement-breakpoint
CREATE TABLE "app"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_code" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"label" text,
	"user_agent" text,
	"secret_hash" text,
	"status" "app"."device_status" DEFAULT 'active' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"revoked_by_admin_id" uuid,
	CONSTRAINT "devices_device_code_unique" UNIQUE("device_code")
);
--> statement-breakpoint
CREATE TABLE "app"."portal_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" text DEFAULT 'portal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "portal_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app"."route_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"assigned_on" date NOT NULL,
	"assigned_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_assignments_uniq" UNIQUE("route_id","agent_id","assigned_on")
);
--> statement-breakpoint
CREATE TABLE "app"."route_entities" (
	"route_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "route_entities_uniq" UNIQUE("route_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "app"."categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_sw" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."entity_rule_overrides" (
	"entity_id" uuid NOT NULL,
	"tax_rule_id" uuid NOT NULL,
	"kind" "app"."override_kind" NOT NULL,
	"reason" text NOT NULL,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_rule_overrides_entity_id_tax_rule_id_pk" PRIMARY KEY("entity_id","tax_rule_id")
);
--> statement-breakpoint
CREATE TABLE "app"."tax_rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tax_rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "app"."rule_version_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"calc_kind" "app"."rule_calc_kind" NOT NULL,
	"amount_fc" integer,
	"rate_bp" integer,
	"frequency" "app"."rule_frequency" NOT NULL,
	"due_day" integer,
	"penalty_kind" "app"."penalty_kind" DEFAULT 'none' NOT NULL,
	"penalty_rate_bp" integer,
	"penalty_amount_fc" integer,
	"grace_days" integer DEFAULT 30 NOT NULL,
	"penalty_cap_bp" integer,
	"reference_document" text,
	"proposed_by_admin_id" uuid,
	"approved_by_admin_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rule_versions_rule_version_uniq" UNIQUE("tax_rule_id","version"),
	CONSTRAINT "tax_rule_versions_rule_effective_uniq" UNIQUE("tax_rule_id","effective_from"),
	CONSTRAINT "tax_rule_versions_calc_shape" CHECK (("app"."tax_rule_versions"."calc_kind" = 'fixed' and "app"."tax_rule_versions"."amount_fc" is not null and "app"."tax_rule_versions"."amount_fc" >= 0) or ("app"."tax_rule_versions"."calc_kind" = 'percent_of_base' and "app"."tax_rule_versions"."rate_bp" is not null and "app"."tax_rule_versions"."rate_bp" >= 0)),
	CONSTRAINT "tax_rule_versions_penalty_shape" CHECK (("app"."tax_rule_versions"."penalty_kind" = 'none') or ("app"."tax_rule_versions"."penalty_kind" in ('once_percent','monthly_percent') and "app"."tax_rule_versions"."penalty_rate_bp" >= 0) or ("app"."tax_rule_versions"."penalty_kind" = 'once_fixed' and "app"."tax_rule_versions"."penalty_amount_fc" >= 0)),
	CONSTRAINT "tax_rule_versions_grace_nonneg" CHECK ("app"."tax_rule_versions"."grace_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"tax_code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_sw" text,
	"category_id" uuid NOT NULL,
	"issuing_authority" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"kind" "app"."entity_kind" NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"commune_id" uuid NOT NULL,
	"quartier_id" uuid,
	"location" geometry(point) NOT NULL,
	"gps_accuracy_m" integer,
	"tax_base_fc" integer,
	"active" boolean DEFAULT true NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"registered_by_agent_id" uuid,
	"client_uuid" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_client_uuid_unique" UNIQUE("client_uuid"),
	CONSTRAINT "entities_tax_base_fc_nonneg" CHECK ("app"."entities"."tax_base_fc" is null or "app"."entities"."tax_base_fc" >= 0),
	CONSTRAINT "entities_gps_accuracy_nonneg" CHECK ("app"."entities"."gps_accuracy_m" is null or "app"."entities"."gps_accuracy_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."entity_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "app"."photo_kind" DEFAULT 'facade' NOT NULL,
	"storage_path" text NOT NULL,
	"bytes" integer NOT NULL,
	"taken_at" timestamp with time zone,
	"uploaded_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_photos_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "app"."exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"tax_rule_id" uuid,
	"reason" text NOT NULL,
	"reference_document" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"granted_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."taxpayers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_no" text NOT NULL,
	"kind" "app"."taxpayer_kind" NOT NULL,
	"full_name" text NOT NULL,
	"contact_name" text,
	"phone" text NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"id_type" text,
	"id_number" text,
	"commune_id" uuid NOT NULL,
	"quartier_id" uuid,
	"address" text NOT NULL,
	"exempt_reason" text,
	"registered_at" timestamp with time zone NOT NULL,
	"registered_by_agent_id" uuid,
	"registered_device_id" uuid,
	"client_uuid" uuid,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxpayers_taxpayer_no_unique" UNIQUE("taxpayer_no"),
	CONSTRAINT "taxpayers_client_uuid_unique" UNIQUE("client_uuid")
);
--> statement-breakpoint
CREATE TABLE "app"."obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"tax_rule_id" uuid NOT NULL,
	"tax_rule_version_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_fc" integer NOT NULL,
	"penalty_fc" integer DEFAULT 0 NOT NULL,
	"paid_fc" integer DEFAULT 0 NOT NULL,
	"status" "app"."obligation_status" DEFAULT 'due' NOT NULL,
	"waived_reason" text,
	"waived_by_admin_id" uuid,
	"cancelled_reason" text,
	"cancelled_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligations_entity_rule_period_uniq" UNIQUE("entity_id","tax_rule_id","period_start"),
	CONSTRAINT "obligations_amount_nonneg" CHECK ("app"."obligations"."amount_fc" >= 0),
	CONSTRAINT "obligations_penalty_nonneg" CHECK ("app"."obligations"."penalty_fc" >= 0),
	CONSTRAINT "obligations_paid_nonneg" CHECK ("app"."obligations"."paid_fc" >= 0),
	CONSTRAINT "obligations_period_order" CHECK ("app"."obligations"."period_start" <= "app"."obligations"."period_end")
);
--> statement-breakpoint
CREATE TABLE "app"."payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"kind" "app"."allocation_kind" DEFAULT 'principal' NOT NULL,
	"amount_fc" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_uniq" UNIQUE("payment_id","obligation_id","kind"),
	CONSTRAINT "payment_allocations_amount_positive" CHECK ("app"."payment_allocations"."amount_fc" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"entity_id" uuid,
	"amount_fc" integer NOT NULL,
	"channel" "app"."payment_channel" NOT NULL,
	"origin" "app"."payment_origin" NOT NULL,
	"payer_phone" text NOT NULL,
	"status" "app"."payment_status" DEFAULT 'initiated' NOT NULL,
	"provider_request_id" text,
	"initiated_by_agent_id" uuid,
	"initiated_device_id" uuid,
	"expires_at" timestamp with time zone,
	"pending_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date GENERATED ALWAYS AS (util.business_date(created_at)) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payments_amount_positive" CHECK ("app"."payments"."amount_fc" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."provider_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" "app"."payment_channel" NOT NULL,
	"provider_reference" text NOT NULL,
	"amount_fc" integer NOT NULL,
	"payer_phone" text,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date GENERATED ALWAYS AS (util.business_date(created_at)) STORED,
	CONSTRAINT "provider_confirmations_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "provider_confirmations_provider_ref_uniq" UNIQUE("provider","provider_reference"),
	CONSTRAINT "provider_confirmations_amount_nonneg" CHECK ("app"."provider_confirmations"."amount_fc" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."receipt_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_no" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"taxpayer_id" uuid NOT NULL,
	"amount_fc" integer NOT NULL,
	"verify_token" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" "app"."receipt_status" DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date GENERATED ALWAYS AS (util.business_date(created_at)) STORED,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"cancelled_by_admin_id" uuid,
	CONSTRAINT "receipts_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "receipts_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "receipts_verify_token_unique" UNIQUE("verify_token"),
	CONSTRAINT "receipts_amount_nonneg" CHECK ("app"."receipts"."amount_fc" >= 0),
	CONSTRAINT "receipts_cancel_shape" CHECK (("app"."receipts"."status" = 'issued' and "app"."receipts"."cancelled_at" is null) or ("app"."receipts"."status" = 'cancelled' and "app"."receipts"."cancelled_at" is not null and "app"."receipts"."cancelled_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_type" "app"."actor_type" NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"actor_label" text,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"gps" geometry(point),
	"ip" "inet",
	"device_id" uuid,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date GENERATED ALWAYS AS (util.business_date(created_at)) STORED
);
--> statement-breakpoint
CREATE TABLE "app"."daily_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_admin_id" uuid,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"total_fc" integer DEFAULT 0 NOT NULL,
	"note" text,
	CONSTRAINT "daily_closes_business_date_unique" UNIQUE("business_date")
);
--> statement-breakpoint
CREATE TABLE "app"."provider_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" "app"."payment_channel" NOT NULL,
	"provider_reference" text NOT NULL,
	"platform_reference" text,
	"amount_fc" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payer_phone" text,
	"raw" jsonb NOT NULL,
	"match_status" "app"."statement_match_status" DEFAULT 'unmatched' NOT NULL,
	"matched_payment_id" uuid,
	CONSTRAINT "provider_statement_lines_uniq" UNIQUE("run_id","provider","provider_reference"),
	CONSTRAINT "provider_statement_lines_amount_nonneg" CHECK ("app"."provider_statement_lines"."amount_fc" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"type" "app"."exception_type" NOT NULL,
	"status" "app"."exception_status" DEFAULT 'open' NOT NULL,
	"payment_id" uuid,
	"statement_line_id" uuid,
	"platform_amount_fc" integer,
	"statement_amount_fc" integer,
	"note" text,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_date" date NOT NULL,
	"provider" "app"."payment_channel" NOT NULL,
	"status" "app"."reconciliation_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"platform_count" integer DEFAULT 0 NOT NULL,
	"platform_total_fc" integer DEFAULT 0 NOT NULL,
	"statement_count" integer DEFAULT 0 NOT NULL,
	"statement_total_fc" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "reconciliation_runs_day_provider_uniq" UNIQUE("business_date","provider")
);
--> statement-breakpoint
CREATE TABLE "app"."complaint_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label_fr" text NOT NULL,
	"label_sw" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "complaint_categories_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "app"."complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_id" uuid,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"contact_phone" text NOT NULL,
	"payment_id" uuid,
	"receipt_id" uuid,
	"status" "app"."complaint_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"handled_by_admin_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"taxpayer_id" uuid,
	"kind" "app"."notification_kind" NOT NULL,
	"channel" "app"."notification_channel" DEFAULT 'sms' NOT NULL,
	"to" text NOT NULL,
	"template_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "app"."notification_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."zones" ADD CONSTRAINT "zones_parent_id_zones_id_fk" FOREIGN KEY ("parent_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_routes" ADD CONSTRAINT "agent_routes_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agent_routes" ADD CONSTRAINT "agent_routes_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agents" ADD CONSTRAINT "agents_zone_id_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."agents" ADD CONSTRAINT "agents_commune_id_zones_id_fk" FOREIGN KEY ("commune_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."devices" ADD CONSTRAINT "devices_revoked_by_admin_id_admin_users_id_fk" FOREIGN KEY ("revoked_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_assignments" ADD CONSTRAINT "route_assignments_route_id_agent_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."agent_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_assignments" ADD CONSTRAINT "route_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_assignments" ADD CONSTRAINT "route_assignments_assigned_by_admin_id_admin_users_id_fk" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."route_entities" ADD CONSTRAINT "route_entities_route_id_agent_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "app"."agent_routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity_rule_overrides" ADD CONSTRAINT "entity_rule_overrides_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "app"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity_rule_overrides" ADD CONSTRAINT "entity_rule_overrides_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "app"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_proposed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("proposed_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_approved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("approved_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."tax_rules" ADD CONSTRAINT "tax_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD CONSTRAINT "entities_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD CONSTRAINT "entities_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD CONSTRAINT "entities_commune_id_zones_id_fk" FOREIGN KEY ("commune_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD CONSTRAINT "entities_quartier_id_zones_id_fk" FOREIGN KEY ("quartier_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entities" ADD CONSTRAINT "entities_registered_by_agent_id_agents_id_fk" FOREIGN KEY ("registered_by_agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity_photos" ADD CONSTRAINT "entity_photos_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."entity_photos" ADD CONSTRAINT "entity_photos_uploaded_by_agent_id_agents_id_fk" FOREIGN KEY ("uploaded_by_agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exemptions" ADD CONSTRAINT "exemptions_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exemptions" ADD CONSTRAINT "exemptions_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "app"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."exemptions" ADD CONSTRAINT "exemptions_granted_by_admin_id_admin_users_id_fk" FOREIGN KEY ("granted_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD CONSTRAINT "taxpayers_commune_id_zones_id_fk" FOREIGN KEY ("commune_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD CONSTRAINT "taxpayers_quartier_id_zones_id_fk" FOREIGN KEY ("quartier_id") REFERENCES "app"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD CONSTRAINT "taxpayers_registered_by_agent_id_agents_id_fk" FOREIGN KEY ("registered_by_agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD CONSTRAINT "taxpayers_registered_device_id_devices_id_fk" FOREIGN KEY ("registered_device_id") REFERENCES "app"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."taxpayers" ADD CONSTRAINT "taxpayers_merged_into_id_taxpayers_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_tax_rule_id_tax_rules_id_fk" FOREIGN KEY ("tax_rule_id") REFERENCES "app"."tax_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_tax_rule_version_id_tax_rule_versions_id_fk" FOREIGN KEY ("tax_rule_version_id") REFERENCES "app"."tax_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_waived_by_admin_id_admin_users_id_fk" FOREIGN KEY ("waived_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."obligations" ADD CONSTRAINT "obligations_cancelled_by_admin_id_admin_users_id_fk" FOREIGN KEY ("cancelled_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payment_allocations" ADD CONSTRAINT "payment_allocations_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "app"."obligations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "app"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_initiated_by_agent_id_agents_id_fk" FOREIGN KEY ("initiated_by_agent_id") REFERENCES "app"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."payments" ADD CONSTRAINT "payments_initiated_device_id_devices_id_fk" FOREIGN KEY ("initiated_device_id") REFERENCES "app"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_confirmations" ADD CONSTRAINT "provider_confirmations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD CONSTRAINT "receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD CONSTRAINT "receipts_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD CONSTRAINT "receipts_cancelled_by_admin_id_admin_users_id_fk" FOREIGN KEY ("cancelled_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_log" ADD CONSTRAINT "audit_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "app"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."daily_closes" ADD CONSTRAINT "daily_closes_closed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("closed_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_statement_lines" ADD CONSTRAINT "provider_statement_lines_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_statement_lines" ADD CONSTRAINT "provider_statement_lines_matched_payment_id_payments_id_fk" FOREIGN KEY ("matched_payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_run_id_reconciliation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "app"."reconciliation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_statement_line_id_provider_statement_lines_id_fk" FOREIGN KEY ("statement_line_id") REFERENCES "app"."provider_statement_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_resolved_by_admin_id_admin_users_id_fk" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."complaints" ADD CONSTRAINT "complaints_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."complaints" ADD CONSTRAINT "complaints_category_id_complaint_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "app"."complaint_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."complaints" ADD CONSTRAINT "complaints_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."complaints" ADD CONSTRAINT "complaints_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "app"."receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."complaints" ADD CONSTRAINT "complaints_handled_by_admin_id_admin_users_id_fk" FOREIGN KEY ("handled_by_admin_id") REFERENCES "app"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."notifications" ADD CONSTRAINT "notifications_taxpayer_id_taxpayers_id_fk" FOREIGN KEY ("taxpayer_id") REFERENCES "app"."taxpayers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zones_commune_code_uniq" ON "app"."zones" USING btree ("code") WHERE "app"."zones"."level" = 'commune';--> statement-breakpoint
CREATE UNIQUE INDEX "zones_quartier_code_uniq" ON "app"."zones" USING btree ("parent_id","code") WHERE "app"."zones"."level" = 'quartier';--> statement-breakpoint
CREATE INDEX "devices_agent_idx" ON "app"."devices" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "portal_links_taxpayer_idx" ON "app"."portal_links" USING btree ("taxpayer_id");--> statement-breakpoint
CREATE INDEX "entities_taxpayer_idx" ON "app"."entities" USING btree ("taxpayer_id");--> statement-breakpoint
CREATE INDEX "entities_category_idx" ON "app"."entities" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "entities_location_gist" ON "app"."entities" USING gist ("location");--> statement-breakpoint
CREATE INDEX "entity_photos_entity_idx" ON "app"."entity_photos" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "exemptions_taxpayer_idx" ON "app"."exemptions" USING btree ("taxpayer_id");--> statement-breakpoint
CREATE INDEX "taxpayers_phone_idx" ON "app"."taxpayers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "taxpayers_commune_idx" ON "app"."taxpayers" USING btree ("commune_id");--> statement-breakpoint
CREATE INDEX "taxpayers_full_name_trgm_idx" ON "app"."taxpayers" USING gin ("full_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "obligations_taxpayer_status_idx" ON "app"."obligations" USING btree ("taxpayer_id","status");--> statement-breakpoint
CREATE INDEX "obligations_due_date_idx" ON "app"."obligations" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "payment_allocations_obligation_idx" ON "app"."payment_allocations" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "payments_taxpayer_idx" ON "app"."payments" USING btree ("taxpayer_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "app"."payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_business_date_idx" ON "app"."payments" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "payments_channel_status_idx" ON "app"."payments" USING btree ("channel","status");--> statement-breakpoint
CREATE INDEX "provider_confirmations_business_date_idx" ON "app"."provider_confirmations" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "receipts_taxpayer_idx" ON "app"."receipts" USING btree ("taxpayer_id");--> statement-breakpoint
CREATE INDEX "receipts_business_date_idx" ON "app"."receipts" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "app"."audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_object_idx" ON "app"."audit_log" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "app"."audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "provider_statement_lines_platform_ref_idx" ON "app"."provider_statement_lines" USING btree ("platform_reference");--> statement-breakpoint
CREATE INDEX "reconciliation_exceptions_run_status_idx" ON "app"."reconciliation_exceptions" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "complaints_status_idx" ON "app"."complaints" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "app"."notifications" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "notifications_taxpayer_idx" ON "app"."notifications" USING btree ("taxpayer_id");