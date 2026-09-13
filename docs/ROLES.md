# Rôles et permissions (brouillon M1, à valider avant M3)

Placeholders from `docs/DECISIONS.md` D29 apply until answered. R = read, W = write, — = no access. "Own zone" means the agent's assigned zone. Every W on a sensitive object writes an `audit_log` row (CLAUDE.md invariant 4).

| Object | Administrateur | Maire | Finances | Superviseur | Auditeur | Agent | Contribuable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Taxpayers, entities (PII: phone, GPS, photos) | R/W | R (aggregates; agent names visible) | R | R/W (corrections, category change with reason, merge) | R | R/W own zone (register, contact fields) | R own record |
| Obligations | R | R | R/W (waive, cancel: reason + second admin) | R | R | R own zone | R own |
| Payments | R | R | R (request reversal: reason + second admin) | R | R | initiate only (`initiated` → `pending`) | initiate own |
| Provider confirmations | R | — | R | — | R | — | — |
| Receipts | R | R | R/W cancel (reason + second admin) | R | R | R own zone | R own, public verify |
| Tax rules and versions | R | R | propose and approve (never both on the same version) | R | R | R | — |
| Agents, devices | R/W (revoke devices) | R | R | R/W (assign routes, revoke devices) | R | own profile | — |
| Reconciliation runs, exceptions, daily close | R | R | R/W (resolve, attach, close day) | R | R | — | — |
| Audit log | R | R | R | R | R + export | — | — |
| Exports (Excel, PDF) | all | aggregates | all | zone reports | all | — | own receipts |
| Admin users and roles | R/W | — | — | — | R | — | — |

Rules already decided in code:
- `audit_log`, `provider_confirmations` and `receipts` cannot be updated, deleted or truncated by anyone; receipts can only be cancelled with a reason.
- A payment reaches `confirmed` only with a provider confirmation (database trigger); no agent or admin action can set it.
- Authorization is enforced in application code (`lib/identity/requireRole()`, M3). The database exposes schema `app` to the runtime role only.

Open (D29): monetary thresholds for a second approver; whether the Maire sees agent names; who may delete (not merge) a taxpayer.
