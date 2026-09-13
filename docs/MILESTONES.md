# Milestones

One per Claude Code session. Do the first unchecked one. Mark it `[x]` with a short "built / how to demo" note when done.

## M0 — Scaffold
- [x] pnpm + Next.js 16 + TypeScript strict + Tailwind + shadcn/ui + ESLint + Vitest + Playwright configured. `pnpm dev`, `typecheck`, `lint`, `test` all run green on an empty app. `.env.example` written. Supabase project connected (local via `supabase start` is fine). Drizzle configured with an empty migration. README with setup steps.
- Built (2026-09-13): Next 16.3 + React 19.2, TypeScript 5.9 strict, Tailwind 4 + shadcn (`radix-nova`) with the prototype palette as CSS tokens, ESLint 9 flat config + Prettier, Vitest 4, Playwright 1.63, Drizzle 0.45 + `pg`, local Supabase (analytics, realtime, storage, edge runtime off until needed), empty custom migration `0000_init` applied, `lib/i18n/fr.ts` as the only source of French, `lib/db/client.ts` lazy singleton, seed stub that refuses production, README. Gates green: typecheck, lint, unit, build, e2e smoke, format.
- Demo (5 steps): 1. `nvm use && pnpm install` · 2. `colima start --cpu 4 --memory 6 && supabase start` · 3. `cp .env.example .env.local` and paste the values printed by `supabase status -o env` · 4. `pnpm db:migrate && pnpm test && pnpm test:e2e` · 5. `pnpm dev`, open http://localhost:3000 and read "Plateforme de recouvrement — Ville de Lubumbashi".
- Charter review (2026-09-13, six lenses, 31 findings verified): the notes under M1–M9 below come from it; decisions D21–D31 were added to `docs/DECISIONS.md`.

## M1 — Schema, roles, audit
- [ ] Tables: `taxpayers`, `entities` (PostGIS point), `zones` (commune, quartier), `categories`, `tax_rules`, `tax_rule_versions`, `obligations`, `payments`, `provider_confirmations`, `receipts`, `agents`, `devices`, `admin_users`, `audit_log`, `reconciliation_runs`, `reconciliation_exceptions`, `notifications`. Row-level security for admin roles. `audit_log` has no UPDATE/DELETE grants. `lib/audit/write()` helper with a test proving a delete fails.
- Demo: `pnpm db:migrate && pnpm db:seed`, open Supabase table view, show audit rows.
- Review notes: (a) create a non-owner runtime role `app_rw` in a custom migration; `DATABASE_URL` uses it, `DATABASE_URL_MIGRATIONS` keeps the owner; REVOKE UPDATE/DELETE/TRUNCATE on `audit_log` from `app_rw`, `anon`, `authenticated`, `service_role` and add a deny trigger; the "delete fails" test connects as `app_rw`. (b) `CREATE EXTENSION postgis` goes in `0001_custom_*`. (c) Add tables the later milestones need: `payment_allocations` (one payment, several obligations; `partially_paid` is derived from it), `receipt_counters`, `id_counters`, `complaints` + `complaint_categories`, `entity_photos`, `agent_routes`/`route_assignments`, `portal_links`, `provider_statement_lines`, `daily_closes`, `exemptions`; `zones.code` explicit (D24); `label_fr` on `categories`, `tax_rules`, `zones`; `gps_accuracy_m` on `entities`; `business_date` generated columns in `Africa/Lubumbashi` on payments, receipts, reconciliation runs. (d) Tax rule versions: `rate_bp`, `calc_kind`, `penalty_kind ∈ {none, once_percent, once_fixed, monthly_percent}`, `grace_days`, `penalty_cap_bp`, `reference_document`; rule versions ↔ categories many-to-many (the prototype's two Commerce entities carry different rule sets). (e) Authorization is enforced in app code (`requireRole()`); RLS plus revoked grants on `anon`/`authenticated` exist to make the auto-generated REST API inert. (f) Write `docs/ROLES.md` (permission matrix; Finances cannot approve its own rate change) before M3.

## M2 — Tax engine
- [ ] `lib/tax-engine`: pure functions. Given an entity's category and a date, produce the obligations due, with amount, period, due date, penalty (after N days, % or fixed), exemptions. Versioned rules by `effective_from`. 100% unit coverage including: rate change mid-year, partial payment allocation (oldest obligation first), penalty capping, exempt taxpayer, percentage-based rule.
- Demo: `pnpm test lib/tax-engine` shows the cases; a script prints obligations for the 5 seeded taxpayers.
- Review notes: rounding rule D22 (`// DECISION-PENDING: D22`), penalties per rule version (not D2's single rule), monthly penalties simple not compounding, cap from `penalty_cap_bp`; liability start D27; boundary tests at 23:59 and 00:01 `Africa/Lubumbashi` on a month end.

## M3 — Admin: auth, tax configuration, taxpayer registry
- [ ] Supabase Auth login for admin users with role. Screens (match prototype): Taxes & barèmes (list + edit creates a new version, requires Finances approval flag), Contribuables (list, search, detail with obligations/payments/journal). Every edit writes to `audit_log`.
- Demo: log in as Finances, change the ménage rate effective next month, show a new version and an audit row; open a taxpayer.

## M4 — Agent app: login, home, census, QR
- [ ] Agent login (matricule + PIN, device registered on first login). Home with route list. Three-step census with GPS capture, photo upload (Supabase Storage, compressed client-side to ≤ 300 KB), duplicate warning (same phone, or name similarity + within 30 m via PostGIS). ID generation `LUB-KAM-NNNNNNNN`. QR generation. Taxpayer profile screen. QR scanning. Installable PWA manifest.
- Demo: on a real Android phone over `pnpm dev` + tunnel, register a household on the street, scan its QR.
- Review notes: offline registration ends on "identifiant attribué à la synchronisation" (no ID, QR or SMS until sync; the QR sticker is printed later and encodes the municipal ID); the terminals' hardware scanner is a keyboard wedge, so the scan screen accepts typed input too; scanning: native `BarcodeDetector` with `@zxing/browser` lazy-loaded as fallback on the scan route (html5-qrcode has had no release since 2023 and weighs ~108 KB gzip) — stack change to confirm; photos upload through a short-lived signed URL issued by our API (agents are not Supabase Auth users); request `navigator.storage.persist()` at first login; Serwist registered for `/agent` only with `next build --webpack`; the 500 KB Playwright check starts here; verify Google Play/Chrome on the real terminal (D25).

## M5 — Payments with mock provider, receipts
- [ ] `lib/payments/provider.ts` interface + `mock` provider (confirms after 3 s, or fails if amount ends in 999). Payment state machine with tests for every transition and for duplicate callbacks. Agent "Encaisser" flow: choose channel, send request, wait screen, confirmed screen, failed screen. Server-issued receipt (PDF + data for SMS), numbered `RCP-YYMM-NNNNNN`, with verification URL. Portal pay flow using the same engine.
- Demo: agent collects 10 000 FC from seeded taxpayer 125 with the mock; receipt PDF opens; verification page shows it authentic.
- Review notes: mock gated by `APP_ENV`, not `NODE_ENV`; write the transition table in `docs/PAYMENTS.md` first (`pending → expired` after `PAYMENT_EXPIRY_HOURS`, late confirmations per D28, `failed → confirmed` refused and raised as an exception); the provider re-query needs a scheduler already here, so the pg-boss worker (`scripts/worker.ts`) is created in M5, not M9; invariant 5's 4-character suffix is authoritative (the prototype's 2-character samples are illustrative); a retry is a new payment row; persist the provider's own request id; seed demo payments through the mock so `provider_confirmations` rows exist with a raw payload marked `seeded: true`; receipts embed TTF fonts (`next/font` is not used at render time) and format amounts with `formatFC()`; the public verify URL is `/v/<receipt_no>/<token>` so sequential numbers cannot be enumerated.

## M6 — Dashboard overview, collections, map, agents
- [ ] Vue d'ensemble KPIs (registered, assessed, collected, rate, unpaid), daily bar chart, by-channel bars, alerts. Recettes with filters (period, commune, tax, channel, agent) and receipt table. Carte with Leaflet, status-coloured markers, filters. Agents table with failure rate and out-of-zone count, device revoke.
- Demo: the mayor's walkthrough: overview → click alert → agents → revoke a device → map.

## M7 — Taxpayer portal + notifications (SMS mocked)
- [ ] Signed-link access (`/t/<token>`), balance, obligations detail, pay (mock), receipts list, verify receipt (public), complaint form with categories incl. "Les déchets ne sont pas collectés". `lib/notify` with a `console` SMS provider; templates in French for: registration, payment confirmed, reminder, receipt.
- Demo: open the SMS link on a phone, pay, receive the (console) receipt SMS.

## M8 — Offline census
- [ ] Dexie outbox for census + contact updates only. Client UUIDs. Background sync on reconnect. Idempotent `POST /api/v1/census` (same client UUID → same record). Sync screen with queue. Conflict rules documented in `docs/OFFLINE.md`. Playwright test: create 30 records offline (route interception), reconnect, exactly 30 on server.
- Demo: airplane mode on the phone, register 5, reconnect, watch them arrive.
- Review notes: define offline unlock (local PIN bound to a server-issued device session, D31), the read cache (assigned route + zone profiles with `synced_at` and a staleness banner from `fr.ts`), and that a census outbox item may carry its photo blob whose upload failure never blocks the record.

## M9 — Reconciliation engine (with mock statements)
- [ ] `fetchStatement(date)` on the provider interface; mock returns a statement with one missing, one duplicate, one unknown line. Nightly pg-boss job matches by reference + amount, writes `reconciliation_runs` and exceptions. Admin Rapprochement screen with the three exception types and actions (re-query, request reversal, attach to taxpayer). Daily close requires zero open exceptions.
- Demo: run the job for yesterday, resolve the three exceptions, close the day.
- Review notes: add the `status_mismatch` exception type and a test for `amount_mismatch`; define what happens when a provider statement is missing for a day (close blocked); business day is `Africa/Lubumbashi`.

## M10 — Exports, audit screen, hardening
- [ ] Excel + PDF exports for the six reports in the prototype. Journal d'audit screen with filters. Rate limiting on auth and payment endpoints, session expiry, device revocation enforced server-side. Backup + restore drill documented in `docs/OPERATIONS.md`. Lighthouse on agent app ≥ 90 performance on "Slow 4G".
- Demo: export the monthly report; show the audit trail of everything done during the demo.

## Later (not before DECISIONS are answered)
- Real providers: `mpesa`, `airtel`, `orange`, `tpe` — one session each.
- Real SMS (Africa's Talking) and WhatsApp Cloud API.
- Swahili `sw.ts`.
- Native Android wrapper if TPE terminals require it.
