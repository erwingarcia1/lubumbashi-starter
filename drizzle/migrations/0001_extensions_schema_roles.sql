-- Custom migration (SQL Drizzle cannot express). Written once, frozen once applied.
-- Extensions live in the `extensions` schema (Supabase convention; created here for plain Postgres).
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
--> statement-breakpoint
-- Helper functions used by generated columns live in `util` (schema `app` is created by the generated migration).
CREATE SCHEMA IF NOT EXISTS util;
--> statement-breakpoint
-- Business day in Africa/Lubumbashi (UTC+2, no DST), used by the generated business_date columns.
CREATE OR REPLACE FUNCTION util.business_date(ts timestamptz) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
  AS $$ SELECT (ts AT TIME ZONE 'Africa/Lubumbashi')::date $$;
--> statement-breakpoint
-- Runtime group role (CLAUDE.md invariant 4). The login member `app_login` is created by scripts/db-roles.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN;
  END IF;
END
$$;
