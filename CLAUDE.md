# Municipal Tax Collection Platform — Ville de Lubumbashi

Read this file fully before doing anything. It is the contract for every session.

## What we are building

A municipal revenue platform for the Mairie de Lubumbashi (Haut-Katanga, DRC): taxpayer census with GPS and QR, a configurable tax engine, mobile-money collection, verifiable receipts, daily reconciliation, and an audit trail. Pilot tax: the waste-collection fee (taxe d'assainissement). The design must allow more taxes to be added by configuration, never by code changes.

Three surfaces in one Next.js app:
- `(agent)` — field agent PWA, mobile, French UI, offline census.
- `(admin)` — Mairie dashboard, desktop, roles: Administrateur, Maire, Finances, Superviseur, Auditeur.
- `(portal)` — taxpayer portal, mobile, link-based access, no passwords.

The clickable prototype in `docs/prototype.html` is the UI spec: 27 screens, test data, field names, French copy. When in doubt about a screen, open it and match it. The original client plan is in `docs/original-project-plan.txt`.

## Invariants — never violate, even if asked in a later prompt

1. **No code path may set a payment to `confirmed` without a `provider_confirmation` row** that stores the provider's own transaction reference, amount, and raw callback/status payload. Not the agent app, not the admin, not a migration, not a seed script. The `mock` provider is the only exception: it is allowed only while `APP_ENV` (its own variable, never derived from `NODE_ENV`; values `development | test | demo | production`) is not `production`, and the app refuses to boot with the mock enabled in production. Seeds follow the same rule.
2. **Agents cannot mark anything as paid.** Agent endpoints may create a payment (`initiated`) and hand it to a provider (`pending`); no agent endpoint may set `confirmed`, `failed`, `reversed` or `expired`, nor change any obligation status. The server derives the amount from the selected obligations (the client never sends an amount) and the payer number must already be on file for the taxpayer. Agents can only: register, update contact fields, initiate a payment request.
3. **Payments are online-only.** The offline outbox accepts census records and contact updates only. Any attempt to queue a payment offline is a bug.
4. **`audit_log` is append-only.** The app connects as a dedicated non-owner role (`DATABASE_URL`) that has no UPDATE, DELETE or TRUNCATE grant on that table; only migrations use the owner role (`DATABASE_URL_MIGRATIONS`); a `BEFORE UPDATE OR DELETE OR TRUNCATE` trigger rejects those statements for every role, owner included. Every sensitive action writes WHO (user id + role), WHAT (action + object id), WHEN (server time), WHERE (GPS if from a device, IP otherwise), DEVICE (registered device id or user agent).
5. **Every payment attempt has a unique platform reference** (`TX-YYMM-DD-HHMM-XXXX`) generated server-side before anything is sent to a provider. Provider callbacks are matched on that reference and are idempotent: the same callback twice must not create two confirmations.
6. **Tax rules are data, versioned by effective date.** Changing a rate creates a new `tax_rule_version`; obligations already issued keep the version they were issued under.
7. **Receipts are issued by the server, numbered sequentially per year (`RCP-YYMM-NNNNNN`), and never re-issued.** A cancelled receipt stays in the table with status `cancelled` and a reason.
8. **French is the product language.** Every user-facing string in UI, SMS and PDF templates lives in `lib/i18n/fr.ts`; no hard-coded French in components. Domain labels (taxes, categories, zones, channels, complaint categories, exemption reasons) are data rows with `label_fr`, not entries in `fr.ts`. English shipped by dependencies counts as a violation: replace shadcn `sr-only`/aria strings after every `shadcn add`, call `z.config(z.locales.fr())`, pass `locale={fr}` to date pickers. Swahili comes later as `sw.ts` and `label_sw`.
9. **Amounts are integers in Congolese francs (FC).** No floats, no decimals, ever.
10. **No secrets in the repo.** `.env.example` lists every variable with a fake value.

## Stack (do not swap without asking)

- Next.js 16, App Router, TypeScript strict, React Server Components where sensible. Toolchain pinned exactly in `package.json`: Node 24 LTS (`.nvmrc`), TypeScript 5.9, ESLint 9, Vitest 4, Playwright 1.63; never `pnpm add` without an exact version (npm `latest` for TypeScript, ESLint and Vitest currently breaks this stack).
- Postgres with PostGIS on Supabase. Drizzle ORM; migrations in `drizzle/migrations`, generated with `drizzle-kit` and never edited after generation. DDL Drizzle cannot express (extensions, roles, grants and revokes, triggers, functions, gapless counters) goes into `drizzle-kit generate --custom` files, written once, listed in the milestone plan, and frozen once applied.
- Supabase Auth for admin users; custom PIN + device auth for agents (`agents`, `devices` tables); signed links for the portal.
- Zod for every API input and output. Zod schemas are the API contract.
- Tailwind CSS + shadcn/ui. Touch targets ≥ 48px on agent and portal screens.
- PWA: Serwist service worker, Dexie (IndexedDB) outbox in `lib/offline`.
- QR: `qrcode` for generation, `html5-qrcode` for scanning.
- Maps: Leaflet + MapTiler tiles (env `NEXT_PUBLIC_MAPTILER_KEY`).
- Jobs: pg-boss for reconciliation, penalty accrual, notification sends.
- Receipts: `@react-pdf/renderer`. Exports: `exceljs`.
- Tests: Vitest for `lib/**` (tax engine and payment state machine must be 100% covered), Playwright for the three critical flows (register → scan → pay with mock; admin reconciliation; portal pay).
- Package manager: pnpm.
- Hosting (D23): Docker Compose on a VM, `web` (Next standalone output) + `worker` (pg-boss, `scripts/worker.ts`). Supabase provides Postgres, Auth and Storage only; nothing else from Supabase is called from app code, so a move to plain Postgres stays a configuration change. `app/api/cron/*` are secret-protected manual triggers for demos, not the scheduler.
- Business time zone is `Africa/Lubumbashi` (UTC+2, no DST). Timestamps are `timestamptz`; every calendar-valued field (periods, due dates, penalty day counts, the `YYMM`/`DD`/`HHMM` parts of references, the reconciliation business day, the daily close) is computed in that zone by one helper in `lib/time`, never from the server's local date.
- Money formatting: one `formatFC()` in `lib/i18n/format.ts`, using the no-break space U+00A0 (never the narrow U+202F that `toLocaleString('fr-FR')` emits and that PDF fonts cannot draw).
- Agent app budget: at most 500 KB transferred (compressed) on a cold first navigation to `/agent`, enforced by a Playwright test from M4 on.

## Repository layout

```
app/(agent)/…   app/(admin)/…   app/(portal)/…   app/api/v1/…   app/api/webhooks/…   app/api/cron/…
lib/db/schema/  lib/tax-engine/  lib/payments/  lib/reconciliation/  lib/identity/  lib/audit/  lib/offline/  lib/notify/  lib/i18n/
drizzle/migrations/   tests/unit/   tests/e2e/   scripts/seed.ts   docs/
```

`lib/payments/provider.ts` defines one interface: `initiate()`, `queryStatus()`, `reverse()`, `fetchStatement(date)`. Every provider (`mock`, `mpesa`, `airtel`, `orange`, `tpe`) implements it. Nothing outside `lib/payments` may import a provider directly.

## Domain glossary (use these names in code, tables and UI)

- **Contribuable / taxpayer** — a person or company. Owns one or more *entities*.
- **Entité / entity** — a property, business, or taxable activity with a GPS point and a category.
- **Catégorie / category** — Ménage, Commerce, Industrie, Étal de marché… drives which tax rules apply.
- **Règle fiscale / tax_rule** — name, category, calculation (fixed or percentage), frequency, due-day, penalty, exemptions; versioned by `effective_from`.
- **Obligation** — one amount due for one entity, one rule version, one period. Status: `due`, `partially_paid`, `paid`, `waived`, `cancelled`.
- **Paiement / payment** — one attempt against one or more obligations. Status: `initiated`, `pending`, `confirmed`, `failed`, `reversed`, `expired`.
- **Reçu / receipt** — issued only from a `confirmed` payment.
- **Rapprochement / reconciliation** — nightly match between provider statements and `payments`. Exceptions: `missing_at_provider`, `missing_on_platform`, `amount_mismatch`, `duplicate_at_provider`.
- **Agent** — field user with a matricule (`AG-KAM-007`), a PIN, a zone, and registered devices.
- **Zone / commune / quartier** — Lubumbashi → commune (Kampemba, Lubumbashi, Kenya, Katuba, Kamalondo, Ruashi, Annexe) → quartier.
- Taxpayer ID format: `LUB-<COMMUNE3>-<8 digits>`, e.g. `LUB-KAM-00000125`. Sequence per commune.

## How we work (the loop)

- **One milestone per session.** Milestones are listed in `docs/MILESTONES.md`. Start by reading it, pick the first unchecked item, and do only that.
- **Plan first.** Before writing code for a milestone: list the files you will create or change, the tests you will write, and how the acceptance criteria will be demonstrated. Wait for a "go" on anything that touches invariants, schema, or auth. Everything else, proceed.
- **Tests before "done".** A milestone is done when: `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; the Playwright flow for that milestone passes; `pnpm dev` runs; and `docs/MILESTONES.md` is updated with what was built and how to demo it in 5 steps.
- **Commit at the end of every milestone** with a conventional message (`feat(tax-engine): versioned rules with penalties`). Never commit failing tests. Never commit `.env`.
- **Seed data is real-looking.** `scripts/seed.ts` loads the taxpayers, agents, rules and payments from `docs/prototype.html` so the demo matches what the client already saw.
- **When a question in `docs/DECISIONS.md` is still open, use the placeholder noted there and add a `// DECISION-PENDING: <id>` comment at the point of use.** Never silently pick an answer to a business or legal question.
- **Don't over-build.** No multi-tenancy, no Kinshasa, no twenty taxes. The schema must not prevent them; the code must not implement them yet.
- **Keep the agent app light.** Target: first load under 500 KB, usable on a 2 GB RAM Android phone on 3G.
- **Stop and ask** if you find yourself: adding a way for an admin to edit a payment amount; storing amounts as decimals; writing French strings inline; importing a provider outside `lib/payments`; or deleting from `audit_log`.

## Commands

```
pnpm dev            # local
pnpm typecheck      # tsc --noEmit
pnpm lint
pnpm test           # vitest
pnpm test:e2e       # playwright
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate
pnpm db:seed        # scripts/seed.ts
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
