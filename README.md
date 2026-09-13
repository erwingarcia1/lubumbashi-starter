# Plateforme de recouvrement — Ville de Lubumbashi

Municipal revenue platform for the Mairie de Lubumbashi: taxpayer census with GPS and QR, a configurable tax engine, mobile-money collection, verifiable receipts, nightly reconciliation and an append-only audit trail. Three surfaces in one Next.js app:

| Surface                              | URL prefix                                        | Users                                                  |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------ |
| Agent PWA (mobile, offline census)   | `/agent`                                          | field agents (matricule + PIN, registered device)      |
| Mairie dashboard (desktop)           | `/admin`                                          | Administrateur, Maire, Finances, Superviseur, Auditeur |
| Taxpayer portal (mobile, link-based) | `/t/<token>`, public receipt check `/v/<receipt>` | taxpayers                                              |

`CLAUDE.md` is the contract (invariants, stack, working loop). `docs/MILESTONES.md` is the plan of record, `docs/DECISIONS.md` the register of open business questions, `docs/prototype.html` the UI specification.

## Prerequisites (macOS)

| Tool          | Version                 | Install                                                             |
| ------------- | ----------------------- | ------------------------------------------------------------------- |
| Node          | 24 LTS (`.nvmrc`)       | `nvm install 24 && nvm alias default 24`                            |
| pnpm          | 12.4 (`packageManager`) | `brew install pnpm`                                                 |
| Docker daemon | Colima                  | `brew install colima docker` then `colima start --cpu 4 --memory 6` |
| Supabase CLI  | 2.117+                  | `brew install supabase/tap/supabase`                                |

The local Supabase stack pulls about 2 GB of images the first time; keep at least 8 GB of free disk.

## Setup

```bash
nvm use
pnpm install                                  # pnpm 12 stops on unreviewed build scripts: see pnpm-workspace.yaml
colima start --cpu 4 --memory 6
SUPABASE_USE_SLIM_IMAGES=true supabase start  # Postgres 54322, API 54321, Studio 54323, Mailpit 54324
cp .env.example .env.local                    # paste the values printed by: supabase status -o env
pnpm db:migrate                               # migrations + creates the runtime role app_login (APP_DB_PASSWORD)
pnpm db:seed                                  # prototype data + admin logins (refuses production)
pnpm exec playwright install chromium --only-shell
pnpm dev                                      # http://localhost:3000
```

`.env.local` is ignored by git. `.env.example` documents every variable with a placeholder value; add a variable there in the same change that introduces it.

## Commands

| Command                             | What it does                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | development server (Turbopack)                                                              |
| `pnpm build` / `pnpm start`         | production build (standalone output) and server                                             |
| `pnpm typecheck`                    | `next typegen && tsc --noEmit`                                                              |
| `pnpm lint`                         | ESLint (flat config)                                                                        |
| `pnpm format` / `pnpm format:check` | Prettier (never touches `docs/` or `CLAUDE.md`)                                             |
| `pnpm test` / `pnpm test:coverage`  | Vitest unit tests for `lib/**` and `tests/unit/**`                                          |
| `pnpm test:e2e`                     | Playwright; starts `pnpm dev` itself (in CI: `pnpm build` first, it then uses `pnpm start`) |
| `pnpm db:generate`                  | `drizzle-kit generate` (add `--custom --name <topic>` for SQL Drizzle cannot express)       |
| `pnpm db:migrate`                   | apply `drizzle/migrations` with the owner connection (`DATABASE_URL_MIGRATIONS`)            |
| `pnpm db:seed`                      | `scripts/seed.ts` (refuses to run in production)                                            |

Before committing: `git status --porcelain | grep -E '(^|/)\.env(\.|$)' | grep -v '\.env\.example'` must print nothing.

## Layout

```
app/            Next.js App Router: (agent), (admin), (portal), api/v1, api/webhooks, api/cron
lib/            db, tax-engine, payments, reconciliation, identity, audit, offline, notify, i18n
drizzle/        migrations (generated; custom SQL only via `drizzle-kit generate --custom`)
supabase/       local stack config (`supabase/config.toml`)
tests/unit      Vitest · tests/e2e   Playwright
scripts/        seed.ts, later worker.ts (pg-boss)
docs/           MILESTONES.md, DECISIONS.md, PROMPTS.md, prototype.html, original-project-plan.txt
```

## Admin dashboard

`/admin/login` with a seeded account: `ngoy.k@lubumbashi.cd` (Finances), `admin@lubumbashi.cd` (Administrateur), `ilunga.m@lubumbashi.cd` (Superviseur), `maire@`, `auditeur@`; password `SEED_ADMIN_PASSWORD` from `.env.local`. Roles and permissions: `docs/ROLES.md`; the rate-version approval policy is the `rule_version_approval` row of `app.settings`.

## Agent app

`/agent/login` on a phone-sized viewport: matricule `AG-KAM-007`, PIN `123456` (seeded). The first login registers the browser as a device (`DEV-xxxx`, secret in localStorage); revoking the device in the database logs it out on the next request. Camera and GPS need HTTPS on a real phone: see `docs/OPERATIONS.md` (tunnel or VM deploy).

## Payments (mock)

`PAYMENT_PROVIDERS=mock` routes every channel to the simulator: a payment confirms 3 s after initiation, or fails when the amount ends in 999. The simulator is refused when `APP_ENV=production` (CLAUDE.md invariant 1). Receipts: `/api/v1/receipts/<no>/pdf`; public check: `/v/<no>/<token>` (link on the receipt).

## Database roles

- Migrations and role management use the owner connection (`DATABASE_URL_MIGRATIONS`).
- The app connects as `app_login`, member of `app_rw`: full access to schema `app` except UPDATE/DELETE/TRUNCATE on `audit_log` and `provider_confirmations`, and DELETE on `receipts`; no DDL. Supabase's `anon`/`authenticated` roles have no access to schema `app`, and the REST API does not expose it.
- On hosted Supabase, connect as `app_login` through the direct connection or as `app_login.<project-ref>` through the pooler; rotate `APP_DB_PASSWORD` and rerun `pnpm db:roles`.

## Troubleshooting

- **`pnpm install` exits listing "ignored build scripts"**: run `pnpm approve-builds`, commit the updated `pnpm-workspace.yaml`.
- **`supabase start` cannot reach Docker**: `colima status`; if stopped, `colima start --cpu 4 --memory 6`. The analytics (`vector`) container is disabled in `supabase/config.toml` because it breaks on Colima.
- **`next dev` rewrites a block at the end of `CLAUDE.md`**: that is Next 16's agent-rules block; it is committed on purpose so the tree stays clean.
- **Telemetry**: Next.js collects anonymous telemetry unless `NEXT_TELEMETRY_DISABLED=1` is set (see `.env.example`).
