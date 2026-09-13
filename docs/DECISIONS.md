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
