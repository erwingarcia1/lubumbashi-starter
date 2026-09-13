# Open decisions

Business and legal questions the code must not answer on its own. While a decision is `OPEN`, use the placeholder and mark the code with `// DECISION-PENDING: D<n>`. When answered, change the status, record the answer and the date, and remove the markers.

| ID | Question | Status | Placeholder until answered | Answer |
|----|----------|--------|----------------------------|--------|
| D1 | Who is the client and who owns code and data? | OPEN | Repo private; no licence file | |
| D2 | Exact taxes, categories, amounts, frequencies, due dates for the pilot (with the arrêté that sets them) | OPEN | Assainissement: Ménage 5 000 FC/mois, Commerce 25 000 FC/mois, Industrie 150 000 FC/mois; Étal de marché 15 000 FC/mois; Patente 50 000 FC/an. Due last day of period. Penalty 10% after 30 days. | |
| D3 | Who legally sets/changes rates; is a document required per change? | OPEN | `tax_rule_versions.reference_document` nullable text | |
| D4 | Exemption policy (elderly, indigent, others) and who maintains the list | OPEN | `taxpayers.exempt_reason` nullable; no automatic exemptions | |
| D5 | Are partial payments allowed? | OPEN | Yes, allocated oldest obligation first | |
| D6 | Existing taxpayer list / cadastre to import? | OPEN | None; start empty | |
| D7 | Standard identity document | OPEN | Free-text `id_type` + `id_number`, optional | |
| D8 | Is phone number mandatory? | OPEN | Required on census | |
| D9 | Agents: employees or contractors; paid how? | OPEN | No incentive logic built | |
| D10 | Is cash collection by agents allowed? | OPEN | No. No cash channel exists in code. | |
| D11 | Mobile money providers in order of priority; existing merchant accounts | OPEN | `mock` only | |
| D12 | Provider statements: API, CSV, or portal? | OPEN | `fetchStatement()` returns mock data | |
| D13 | Who pays the transaction fee? | OPEN | Portal shows "Pris en charge par la Mairie" as placeholder text | |
| D14 | Bank(s) and TPE terminals in use | OPEN | `tpe` provider not implemented | |
| D15 | Is an SMS/electronic receipt legally valid, or is a paper quittance required? | OPEN | PDF + SMS receipt; no print path | |
| D16 | May the official seal appear on digital receipts? | OPEN | Text header "VILLE DE LUBUMBASHI" only, no seal image | |
| D17 | Must data be hosted in DRC? | OPEN | Supabase (EU region); keep everything Docker-portable | |
| D18 | Data protection rules for citizen data (names, phone, GPS, photos) | OPEN | Phone masked in UI for Agent role; photos private bucket | |
| D19 | Language(s) for citizens: French only or French + Swahili | OPEN | French only | |
| D20 | Pilot commune and expected number of households | OPEN | Kampemba, ~2 500 | |
| D21 | Receipt counter per year or per month (the prototype's numbers reset monthly; invariant 7 says per year); must the series be gapless? | OPEN | Per-year gapless counter row (`receipt_counters`) locked in the receipt transaction; format `RCP-YYMM-NNNNNN` | |
| D22 | Rounding rule for percentage taxes and penalties (integer FC) | OPEN | Rates stored as integer basis points; results rounded half up to the nearest franc | |
| D23 | Hosting and deployment target (interacts with D17) | ANSWERED 2026-09-13 | — | Docker Compose on a VM: `web` + `worker`; Supabase for Postgres, Auth, Storage |
| D24 | Official three-letter commune codes for taxpayer IDs (naive abbreviations collide: Kampemba/Kamalondo; Lubumbashi gives `LUB-LUB`) | OPEN | `zones.code` explicit column seeded KAM, LUB, KEN, KAT, KAL, RUA, ANN | |
| D25 | Exact field terminal model; paper receipts and QR stickers printed at the door from the built-in thermal printer? (needs a native wrapper) | ANSWERED 2026-09-13 | — | PWA only for the pilot; ESC/POS ticket renderer kept ready; verify Google Play/Chrome on the model before M4 |
| D26 | For each pilot tax: which legal entity is the creditor (Ville, Commune, Province), which merchant account receives funds, which legal mentions the receipt must carry | OPEN | Assainissement only; creditor "Ville de Lubumbashi"; one merchant account; header text only | |
| D27 | Does liability start at registration date or earlier (the prototype shows July/August obligations for households registered on 2 September)? | OPEN | Obligations start with the period of registration; no back-dated obligations | |
| D28 | How long a payment stays `pending` before `expired` (prototype: agent waits 2 min, platform re-queries 24 h); is a provider confirmation after expiry accepted? | OPEN | `PAYMENT_EXPIRY_HOURS=24`; `expired → confirmed` accepted on a valid provider confirmation and flagged for reconciliation | |
| D29 | Who may waive or cancel an obligation, cancel a receipt, merge taxpayers, change a category, request a reversal, attach a provider line; reason mandatory; second approver; thresholds | OPEN | Reason + audit row always; waive/cancel/reversal/attach need Finances plus a second admin user; merge and category change need Superviseur | |
| D30 | Are photos mandatory at census, and how many? | OPEN | Optional, one façade photo, ≤ 300 KB | |
| D31 | Agent app idle lock and offline unlock policy | OPEN | Lock after 10 min idle; PIN unlock offline bound to a 12 h device session | |
