# Claude Code prompts

## Before the first session (in your terminal, once)

```bash
mkdir lubumbashi-tax && cd lubumbashi-tax
git init
# copy this starter folder's contents here: CLAUDE.md and docs/
git add . && git commit -m "chore: project charter, prototype, milestones, decisions"
claude
```

Inside Claude Code, run `/init` only if you want it to append to CLAUDE.md — it is already written. Prefer `/model` set to Opus for M1, M2, M5, M8, M9 (schema, tax engine, payments, offline, reconciliation) and Sonnet for the UI milestones if you want to stretch the Max quota.

---

## Prompt 1 — kickoff session (M0)

Paste this as your first message:

```
You are the lead engineer on this project. Before anything else, read CLAUDE.md in full, then docs/MILESTONES.md, docs/DECISIONS.md, and open docs/prototype.html and read it as the UI specification (it is a self-contained HTML prototype: the `S` object near the bottom defines every screen, its French copy, its test data, and the "to confirm" notes per screen; the `TAXPAYERS` array is the seed data).

Then, in plan mode, produce:
1. A one-paragraph restatement of what we are building and the ten invariants, in your own words, so I can check you have understood them.
2. The list of files you will create for milestone M0, and the exact commands you will run to verify it.
3. Anything in CLAUDE.md that you think is contradictory, impossible with the chosen stack, or that you would push back on. Be specific and skeptical; I would rather hear it now.

Stop there and wait for my "go". Do not scaffold yet.
```

After you reply "go":

```
Go. Execute M0 exactly as planned. When pnpm dev, typecheck, lint and test are all green, update docs/MILESTONES.md (mark M0 done with a 5-step demo note), commit with a conventional message, and give me the demo steps. Do not start M1.
```

---

## Prompt 2 — every later milestone (M1 … M10)

Start a fresh session (`/clear`) and paste:

```
Read CLAUDE.md, docs/MILESTONES.md and docs/DECISIONS.md. The next unchecked milestone is the one to do. Open docs/prototype.html and find the screens that belong to this milestone; match their fields, labels and test data.

In plan mode, give me: the files you will create or change, the tests you will write (name each test case), the migration if any, and how the acceptance criteria will be demonstrated. Flag anything that touches an invariant, the schema, or auth, and any DECISION-PENDING placeholder you will rely on.

Wait for "go".
```

Then:

```
Go. Work in this order: schema/migration → lib code with unit tests → API routes with Zod → UI → Playwright flow → seed updates → docs/MILESTONES.md → commit. Run typecheck, lint and test after each step, not only at the end. If a test fails three times in a row on the same cause, stop and explain instead of trying a fourth variant. When done, give me the 5-step demo and a list of any DECISION-PENDING markers you added.
```

---

## Prompt 3 — review pass (run after M2, M5, M8, M9)

Fresh session:

```
Act as an independent reviewer who has never seen this codebase. Read CLAUDE.md. Then try to break each of the ten invariants with concrete code paths, SQL, or API calls: for each invariant, tell me either "holds, here is the test that proves it" or "violated, here is how". Also check: amounts stored as integers everywhere; no French strings outside lib/i18n; no provider imported outside lib/payments; audit_log grants. Report findings ranked by severity, then fix the confirmed ones, add a regression test for each, and commit as "fix(review): …". Do not refactor anything that is not a finding.
```

---

## Prompt 4 — when a decision gets answered

```
Decision D<n> is now answered: <paste the answer>. Update docs/DECISIONS.md, find every DECISION-PENDING: D<n> marker, implement the real behaviour, update or add tests, and commit as "feat(decisions): D<n> …". List every file you changed.
```

---

## Prompt 5 — wiring a real provider (only when merchant credentials exist)

```
Implement the <mpesa|airtel|orange> provider in lib/payments/<name>.ts against the Provider interface, using the sandbox credentials in .env (never print them). Read the provider's API docs I will paste next. Required: initiate with our TX reference as the provider's external reference; webhook handler at app/api/webhooks/<name> that is idempotent on our reference and writes provider_confirmations; queryStatus for the pending-timeout job; fetchStatement for reconciliation. Write tests using recorded fixtures of real sandbox responses (save them under tests/fixtures/<name>/). The mock provider must remain the default outside production. Do not touch the state machine; if the provider needs a state the machine lacks, stop and tell me.
```

---

## Habits that keep the Max quota and the code healthy

- One milestone per session, `/clear` between them. Long sessions drift and burn context.
- Say "go" only after reading the plan. Thirty seconds of reading saves an hour of undoing.
- Never let it "just quickly" touch payments or schema outside a planned milestone.
- Commit at every green state. `git log` is your progress bar and your undo.
- When it loops on a failing test, stop it and paste the error into a fresh session with the file names; a clean context fixes what a tired one cannot.
- Every Friday, run Prompt 3.
