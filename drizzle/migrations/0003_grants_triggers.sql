-- Custom migration (SQL Drizzle cannot express). Written once, frozen once applied.
-- 1. Runtime role privileges: everything in schema app, except that audit rows, provider
--    confirmations and receipts can never be updated, deleted or truncated by the app.
GRANT USAGE ON SCHEMA app TO app_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA extensions TO app_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA util TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_rw;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_log FROM app_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON app.provider_confirmations FROM app_rw;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON app.receipts FROM app_rw;
--> statement-breakpoint
-- Supabase's API roles never see schema app (belt and braces: they hold no grants by default).
REVOKE ALL ON SCHEMA app FROM anon, authenticated, service_role;
--> statement-breakpoint
-- 2. Append-only tables: rejected for every role, owner included (invariant 4).
CREATE OR REPLACE FUNCTION app.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON app.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON app.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER provider_confirmations_immutable BEFORE UPDATE OR DELETE ON app.provider_confirmations
  FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
CREATE TRIGGER provider_confirmations_no_truncate BEFORE TRUNCATE ON app.provider_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_mutation();
--> statement-breakpoint
-- 3. Invariant 1: `confirmed` only together with a provider_confirmation (checked at commit).
CREATE OR REPLACE FUNCTION app.payment_confirmed_requires_confirmation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'confirmed' AND NOT EXISTS (
    SELECT 1 FROM app.provider_confirmations c WHERE c.payment_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'payment % cannot be confirmed without a provider_confirmation', NEW.reference
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payments_confirmed_requires_confirmation
  AFTER INSERT OR UPDATE OF status ON app.payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app.payment_confirmed_requires_confirmation();
--> statement-breakpoint
-- 4. Invariant 7: receipts only from confirmed payments, never re-issued (content immutable).
CREATE OR REPLACE FUNCTION app.receipt_requires_confirmed_payment() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.payments p WHERE p.id = NEW.payment_id AND p.status = 'confirmed') THEN
    RAISE EXCEPTION 'receipt % requires a confirmed payment', NEW.receipt_no
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER receipts_require_confirmed_payment
  AFTER INSERT ON app.receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION app.receipt_requires_confirmed_payment();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.receipt_immutable_fields() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.taxpayer_id IS DISTINCT FROM OLD.taxpayer_id
     OR NEW.amount_fc IS DISTINCT FROM OLD.amount_fc
     OR NEW.verify_token IS DISTINCT FROM OLD.verify_token
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'receipt % is immutable; cancel it instead of editing it', OLD.receipt_no
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER receipts_immutable BEFORE UPDATE ON app.receipts
  FOR EACH ROW EXECUTE FUNCTION app.receipt_immutable_fields();
