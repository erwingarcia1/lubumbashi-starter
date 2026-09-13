# Milestones

One per Claude Code session. Do the first unchecked one. Mark it `[x]` with a short "built / how to demo" note when done.

## M0 — Scaffold
- [ ] pnpm + Next.js 15 + TypeScript strict + Tailwind + shadcn/ui + ESLint + Vitest + Playwright configured. `pnpm dev`, `typecheck`, `lint`, `test` all run green on an empty app. `.env.example` written. Supabase project connected (local via `supabase start` is fine). Drizzle configured with an empty migration. README with setup steps.
- Demo: clone, `pnpm i`, `pnpm dev`, see a page that says "Plateforme de recouvrement — Ville de Lubumbashi".

## M1 — Schema, roles, audit
- [ ] Tables: `taxpayers`, `entities` (PostGIS point), `zones` (commune, quartier), `categories`, `tax_rules`, `tax_rule_versions`, `obligations`, `payments`, `provider_confirmations`, `receipts`, `agents`, `devices`, `admin_users`, `audit_log`, `reconciliation_runs`, `reconciliation_exceptions`, `notifications`. Row-level security for admin roles. `audit_log` has no UPDATE/DELETE grants. `lib/audit/write()` helper with a test proving a delete fails.
- Demo: `pnpm db:migrate && pnpm db:seed`, open Supabase table view, show audit rows.

## M2 — Tax engine
- [ ] `lib/tax-engine`: pure functions. Given an entity's category and a date, produce the obligations due, with amount, period, due date, penalty (after N days, % or fixed), exemptions. Versioned rules by `effective_from`. 100% unit coverage including: rate change mid-year, partial payment allocation (oldest obligation first), penalty capping, exempt taxpayer, percentage-based rule.
- Demo: `pnpm test lib/tax-engine` shows the cases; a script prints obligations for the 5 seeded taxpayers.

## M3 — Admin: auth, tax configuration, taxpayer registry
- [ ] Supabase Auth login for admin users with role. Screens (match prototype): Taxes & barèmes (list + edit creates a new version, requires Finances approval flag), Contribuables (list, search, detail with obligations/payments/journal). Every edit writes to `audit_log`.
- Demo: log in as Finances, change the ménage rate effective next month, show a new version and an audit row; open a taxpayer.

## M4 — Agent app: login, home, census, QR
- [ ] Agent login (matricule + PIN, device registered on first login). Home with route list. Three-step census with GPS capture, photo upload (Supabase Storage, compressed client-side to ≤ 300 KB), duplicate warning (same phone, or name similarity + within 30 m via PostGIS). ID generation `LUB-KAM-NNNNNNNN`. QR generation. Taxpayer profile screen. QR scanning. Installable PWA manifest.
- Demo: on a real Android phone over `pnpm dev` + tunnel, register a household on the street, scan its QR.

## M5 — Payments with mock provider, receipts
- [ ] `lib/payments/provider.ts` interface + `mock` provider (confirms after 3 s, or fails if amount ends in 999). Payment state machine with tests for every transition and for duplicate callbacks. Agent "Encaisser" flow: choose channel, send request, wait screen, confirmed screen, failed screen. Server-issued receipt (PDF + data for SMS), numbered `RCP-YYMM-NNNNNN`, with verification URL. Portal pay flow using the same engine.
- Demo: agent collects 10 000 FC from seeded taxpayer 125 with the mock; receipt PDF opens; verification page shows it authentic.

## M6 — Dashboard overview, collections, map, agents
- [ ] Vue d'ensemble KPIs (registered, assessed, collected, rate, unpaid), daily bar chart, by-channel bars, alerts. Recettes with filters (period, commune, tax, channel, agent) and receipt table. Carte with Leaflet, status-coloured markers, filters. Agents table with failure rate and out-of-zone count, device revoke.
- Demo: the mayor's walkthrough: overview → click alert → agents → revoke a device → map.

## M7 — Taxpayer portal + notifications (SMS mocked)
- [ ] Signed-link access (`/t/<token>`), balance, obligations detail, pay (mock), receipts list, verify receipt (public), complaint form with categories incl. "Les déchets ne sont pas collectés". `lib/notify` with a `console` SMS provider; templates in French for: registration, payment confirmed, reminder, receipt.
- Demo: open the SMS link on a phone, pay, receive the (console) receipt SMS.

## M8 — Offline census
- [ ] Dexie outbox for census + contact updates only. Client UUIDs. Background sync on reconnect. Idempotent `POST /api/v1/census` (same client UUID → same record). Sync screen with queue. Conflict rules documented in `docs/OFFLINE.md`. Playwright test: create 30 records offline (route interception), reconnect, exactly 30 on server.
- Demo: airplane mode on the phone, register 5, reconnect, watch them arrive.

## M9 — Reconciliation engine (with mock statements)
- [ ] `fetchStatement(date)` on the provider interface; mock returns a statement with one missing, one duplicate, one unknown line. Nightly pg-boss job matches by reference + amount, writes `reconciliation_runs` and exceptions. Admin Rapprochement screen with the three exception types and actions (re-query, request reversal, attach to taxpayer). Daily close requires zero open exceptions.
- Demo: run the job for yesterday, resolve the three exceptions, close the day.

## M10 — Exports, audit screen, hardening
- [ ] Excel + PDF exports for the six reports in the prototype. Journal d'audit screen with filters. Rate limiting on auth and payment endpoints, session expiry, device revocation enforced server-side. Backup + restore drill documented in `docs/OPERATIONS.md`. Lighthouse on agent app ≥ 90 performance on "Slow 4G".
- Demo: export the monthly report; show the audit trail of everything done during the demo.

## Later (not before DECISIONS are answered)
- Real providers: `mpesa`, `airtel`, `orange`, `tpe` — one session each.
- Real SMS (Africa's Talking) and WhatsApp Cloud API.
- Swahili `sw.ts`.
- Native Android wrapper if TPE terminals require it.
