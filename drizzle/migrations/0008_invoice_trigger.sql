-- Avis d'imposition numbers: AV-YYMM-NNNNNN (YYMM of the period start), gapless per month, and a
-- random token for the QR on each avis. Assigned by the database so every writer (app, seed,
-- tests) gets one without knowing about it.
CREATE OR REPLACE FUNCTION app.assign_invoice_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  k text;
  n integer;
BEGIN
  IF NEW.invoice_no IS NULL THEN
    k := to_char(NEW.period_start, 'YYMM');
    INSERT INTO app.invoice_counters (yymm, last) VALUES (k, 1)
      ON CONFLICT (yymm) DO UPDATE SET last = app.invoice_counters.last + 1
      RETURNING last INTO n;
    NEW.invoice_no := 'AV-' || k || '-' || lpad(n::text, 6, '0');
  END IF;
  IF NEW.invoice_token IS NULL THEN
    NEW.invoice_token := md5(gen_random_uuid()::text || clock_timestamp()::text);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER obligations_assign_invoice
  BEFORE INSERT ON app.obligations
  FOR EACH ROW EXECUTE FUNCTION app.assign_invoice_no();
--> statement-breakpoint
-- Backfill existing obligations in period order.
DO $$
DECLARE
  r record;
  k text;
  n integer;
BEGIN
  FOR r IN SELECT id, period_start FROM app.obligations WHERE invoice_no IS NULL
           ORDER BY period_start, created_at, id LOOP
    k := to_char(r.period_start, 'YYMM');
    INSERT INTO app.invoice_counters (yymm, last) VALUES (k, 1)
      ON CONFLICT (yymm) DO UPDATE SET last = app.invoice_counters.last + 1
      RETURNING last INTO n;
    UPDATE app.obligations
       SET invoice_no = 'AV-' || k || '-' || lpad(n::text, 6, '0'),
           invoice_token = md5(gen_random_uuid()::text || clock_timestamp()::text)
     WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.invoice_counters TO app_rw;
