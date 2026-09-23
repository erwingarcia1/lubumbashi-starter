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
| D25 | Exact field terminal model; paper receipts and QR stickers printed at the door from the built-in thermal printer? (needs a native wrapper) | RE-OPENED 2026-09-13 | PWA only; ESC/POS ticket renderer kept ready | Answered "PWA only for the pilot" on 2026-09-13, then the refreshed prototype (a-reg3) requires the door sticker printed at registration: choose pocket printer + native wrapper, or pre-printed QR roll matched at registration, before M4 |
| D26 | For each pilot tax: which legal entity is the creditor (Ville, Commune, Province), which merchant account receives funds, which legal mentions the receipt must carry | OPEN | Assainissement only; creditor "Ville de Lubumbashi"; one merchant account; header text only | |
| D27 | Does liability start at registration date or earlier (the prototype shows July/August obligations for households registered on 2 September)? | OPEN | Obligations start with the period of registration; no back-dated obligations | |
| D28 | How long a payment stays `pending` before `expired` (prototype: agent waits 2 min, platform re-queries 24 h); is a provider confirmation after expiry accepted? | OPEN | `PAYMENT_EXPIRY_HOURS=24`; `expired → confirmed` accepted on a valid provider confirmation and flagged for reconciliation | |
| D29 | Who may waive or cancel an obligation, cancel a receipt, merge taxpayers, change a category, request a reversal, attach a provider line; reason mandatory; second approver; thresholds | OPEN | Reason + audit row always; waive/cancel/reversal/attach need Finances plus a second admin user; merge and category change need Superviseur | |
| D30 | Are photos mandatory at census, and how many? | OPEN | Optional, one façade photo, ≤ 300 KB | |
| D31 | Agent app idle lock and offline unlock policy | OPEN | Lock after 10 min idle; PIN unlock offline bound to a 12 h device session | |
| D32 | Portal access: link-only (anyone holding the SMS can see the balance) or an OTP step on top of the signed link? | OPEN | Link-only: 30-day signed link, 12 h cookie session, revocable; door sticker never shows the balance | |
| D34 | When the device gives no GPS position at census (location refused, indoors, laptop), may the agent place the point by hand on a map? Weigh blocked registrations against fake registrations made away from the door | OPEN | Allowed outside production only (development, test, demo/UAT); the entity keeps no accuracy, the audit row records `gpsSource: "manual"` with WHERE = request IP; the server refuses it when `APP_ENV=production` (`manual_position_refused`) | |
| D35 | Note de perception issued from the back office: official template and legal mentions (the Mairie is sending its model), numbering (reuse the avis series `AV-YYMM-NNNNNN` or a separate `NP-` series), signature block, paper vs PDF distribution, and whether penalties accrued since issue appear on the document | OPEN | Layout of `lib/invoices/pdf.tsx` marked `NOTE_TEMPLATE_VERSION = "placeholder-1"`; one note per obligation using its `AV-` number and QR; issue date and issuer recorded on the obligation; amounts as of the print date | |
| D36 | Agent commission scheme: percentage of collections vs fixed per act, per tax or global, who approves and pays, payout channel, treatment of reversals and cancelled receipts, cap per month | OPEN | Rules as data (`commission_rules`): 5 % of confirmed collections initiated by the agent, 500 FC per household registered; reversals deduct in the month they happen; Finances or Administrateur approve then mark paid with a reference; no cap | |
| D37 | Where an agent may collect (geofence): the assigned quartier, the commune, or a radius; blocking vs warning; tolerance for GPS accuracy; what happens without a position | OPEN | Circle of `zones.radius_m` around `zones.centroid` (quartier if set, else commune); a collection outside the circle by more than the GPS accuracy is refused (`outside_zone`); without a position it is refused in production and accepted with a flag elsewhere; census outside the zone stays a warning | |
| D38 | Tracking agents in the field: consent and legal basis under DRC data-protection rules, tracking hours, retention, who may see the trail, use in disciplinary matters | OPEN | Positions collected only while the app is open and the agent logged in, 06:00–20:00 Africa/Lubumbashi, every 3 minutes, kept 90 days then purged; visible to Superviseur, Administrateur and Maire; no sharing outside the Mairie | |
| D33 | Avis d'imposition: numbering series, legal wording per the arrêté (with D2/D3), paper distribution alongside the QR version, and whether a scan lands on payment or on verification first | OPEN | `AV-YYMM-NNNNNN` gapless per period month, assigned by the database; the QR opens the verification screen with "Payer cet avis" one tap away; no paper or PDF avis yet | |
