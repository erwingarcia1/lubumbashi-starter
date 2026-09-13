-- pg-boss (jobs: nightly reconciliation, penalty accrual, notification sends) keeps its tables in
-- its own schema. The runtime role may create and migrate them there itself.
CREATE SCHEMA IF NOT EXISTS pgboss;
--> statement-breakpoint
GRANT ALL ON SCHEMA pgboss TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON TABLES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT ALL ON SEQUENCES TO app_rw;
