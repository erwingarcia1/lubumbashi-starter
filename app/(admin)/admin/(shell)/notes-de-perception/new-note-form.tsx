"use client";

import { useActionState, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatFC, formatMonthFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { baremeFor, penaltyAtIssue, type Bareme } from "@/lib/invoices/bareme";
import type { CreatableRule } from "@/lib/invoices/create";

import type { CreateNoteState } from "./actions";

export interface NoteEntity {
  id: string;
  name: string;
  categoryId: string;
  categoryLabel: string;
  /** Base of the percent rules (integer FC), null when none was captured. */
  taxBaseFc: number | null;
  /** Business month of registration, `YYYY-MM`: the first month a note may cover (D27). */
  registrationMonth: string;
  /** Codes of the rules that apply to this entity (category ± overrides), the only ones offered. */
  ruleCodes: string[];
}

const C = t.admin.invoices.screen.create;
const field = "h-11 text-base md:h-9 md:text-[13px]";
const select =
  "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 text-base md:h-9 md:text-[13px]";
const hint = "text-[11.5px] text-[#5C5456]";
const warning = "text-[11.5px] text-bad";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^\d+$/;

/** The barème of (entity, rule) for the `YYYY-MM` month typed, or null while the month is invalid. */
function baremeOf(
  entity: NoteEntity | undefined,
  rule: CreatableRule | undefined,
  month: string,
): Bareme | null {
  if (!entity || !rule || !MONTH.test(month)) return null;
  return baremeFor(rule, entity.taxBaseFc, `${month}-01`);
}

const amountText = (b: Bareme | null) =>
  b?.amountFc === null || b?.amountFc === undefined ? "" : String(b.amountFc);

const lateText = (days: number) =>
  days === 1 ? C.lateDay : C.lateDays.replace("{n}", String(days));

/** The French line for a refused creation; `duplicate_period` adds the existing note's link. */
function messageOf(state: Extract<CreateNoteState, { status: "error" }>): string {
  const known = C.errors as Record<string, string | undefined>;
  if (state.code === "duplicate_period") return C.errors.duplicate_period;
  if (state.code === "forbidden") return C.errors.forbidden;
  if (state.detail && known[state.detail]) return known[state.detail]!;
  return t.admin.errors[state.code as keyof typeof t.admin.errors] ?? t.admin.errors.invalid_input;
}

/**
 * The « Nouvelle note de perception » card. Controlled fields: React resets an uncontrolled form
 * once the action returns, and a refused submission must keep what the user typed. The barème
 * (period, version in force, amount, due date) is derived in the browser with the same pure
 * functions the server action uses (`lib/invoices/bareme.ts`), for the entity, rule and month
 * chosen; a reason is asked only when the amount really leaves it. The tax select offers only
 * the rules that apply to the chosen entity, the month cannot precede its registration month, and
 * a due date already past shows the penalty the note will carry (`today` is the business day the
 * page was rendered on, so the server and the browser count the same days).
 */
export function NewNoteForm({
  action,
  taxpayerNo,
  q,
  entities,
  rules,
  month: defaultMonth,
  today,
}: {
  action: (state: CreateNoteState, formData: FormData) => Promise<CreateNoteState>;
  taxpayerNo: string;
  q: string;
  entities: NoteEntity[];
  rules: CreatableRule[];
  month: string;
  /** Business date (`YYYY-MM-DD`) of the render. */
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const firstEntity = entities[0];
  const rulesFor = (entity: NoteEntity | undefined) =>
    entity ? rules.filter((r) => entity.ruleCodes.includes(r.code)) : [];
  const ruleFor = (entity: NoteEntity | undefined) => {
    const offered = rulesFor(entity);
    return offered.find((r) => r.categoryId === entity?.categoryId) ?? offered[0];
  };
  const [entityId, setEntityId] = useState(firstEntity?.id ?? "");
  const [ruleCode, setRuleCode] = useState(() => ruleFor(firstEntity)?.code ?? "");
  const [month, setMonth] = useState(defaultMonth);
  /** Null until the user edits it: the due date follows the barème of the period. */
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [amount, setAmount] = useState(() =>
    amountText(baremeOf(firstEntity, ruleFor(firstEntity), defaultMonth)),
  );
  const [reason, setReason] = useState("");
  const [label, setLabel] = useState("");

  const entity = entities.find((e) => e.id === entityId);
  const offered = rulesFor(entity);
  const rule = offered.find((r) => r.code === ruleCode);
  const bareme = baremeOf(entity, rule, month);
  const baremeFc = bareme?.amountFc ?? null;
  const blocked = bareme?.skipped === "no_tax_base";
  const edited = baremeFc !== null && amount.trim() !== "" && Number(amount) !== baremeFc;
  const effectiveDue = dueDate ?? bareme?.dueDate ?? "";
  const derived =
    bareme && bareme.version && bareme.version.frequency !== "monthly" ? bareme.period : null;
  // DECISION-PENDING: D27 — no note before the entity's registration month (server: same check).
  const beforeRegistration = !!entity && MONTH.test(month) && month < entity.registrationMonth;
  const amountInt = INTEGER.test(amount.trim()) ? Number(amount.trim()) : null;
  /** Due date already past: what the note is born owing on top of the principal. */
  const late =
    bareme?.version && amountInt !== null && ISO_DATE.test(effectiveDue) && effectiveDue < today
      ? penaltyAtIssue(bareme.version, amountInt, effectiveDue, today)
      : null;

  /** Entity, rule or month changed: the amount and the due date follow the new barème. */
  function follow(next: { entityId?: string; ruleCode?: string; month?: string }) {
    const e = entities.find((x) => x.id === (next.entityId ?? entityId));
    const r = rules.find((x) => x.code === (next.ruleCode ?? ruleCode));
    setAmount(amountText(baremeOf(e, r, next.month ?? month)));
    setDueDate(null);
  }

  return (
    <form action={formAction} className="mt-2 flex min-w-0 flex-col gap-3">
      <input type="hidden" name="taxpayerNo" value={taxpayerNo} />
      <input type="hidden" name="q" value={q} />
      {state.status === "error" ? (
        <div
          role="alert"
          className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px] break-words"
        >
          {messageOf(state)}
          {state.code === "duplicate_period" && state.existingInvoiceNo ? (
            <>
              {" "}
              <b className="font-mono">{state.existingInvoiceNo}</b> ·{" "}
              <a
                href={`/api/v1/admin/invoices/${state.existingInvoiceNo}/pdf`}
                target="_blank"
                rel="noopener"
                className="font-semibold text-[#C1121F] underline"
              >
                {C.open}
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-entity">{C.entity}</Label>
          <select
            id="note-entity"
            name="entityId"
            value={entityId}
            onChange={(e) => {
              // The tax follows the entity: only its rules are offered, its category's first.
              const next = entities.find((x) => x.id === e.target.value);
              const code = ruleFor(next)?.code ?? "";
              setEntityId(e.target.value);
              setRuleCode(code);
              follow({ entityId: e.target.value, ruleCode: code });
            }}
            className={select}
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.categoryLabel}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-rule">{C.tax}</Label>
          <select
            id="note-rule"
            name="taxRuleCode"
            value={ruleCode}
            onChange={(e) => {
              setRuleCode(e.target.value);
              follow({ ruleCode: e.target.value });
            }}
            aria-invalid={offered.length === 0 || undefined}
            className={select}
          >
            {offered.map((r) => (
              <option key={r.code} value={r.code}>
                {r.labelFr} · {r.categoryLabel}
              </option>
            ))}
          </select>
          {offered.length === 0 ? <span className={warning}>{C.noRule}</span> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-month">{C.period}</Label>
          <Input
            id="note-month"
            name="month"
            type="month"
            required
            min={entity?.registrationMonth}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              follow({ month: e.target.value });
            }}
            aria-invalid={beforeRegistration || undefined}
            className={field}
          />
          {beforeRegistration && entity ? (
            <span className={warning}>
              {C.periodBeforeRegistration.replace(
                "{month}",
                formatMonthFr(`${entity.registrationMonth}-01`),
              )}
            </span>
          ) : derived ? (
            <span className={hint}>
              {C.periodDerived
                .replace("{from}", formatMonthFr(derived.start))
                .replace("{to}", formatMonthFr(derived.end))}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-due">{C.dueDate}</Label>
          <Input
            id="note-due"
            name="dueDate"
            type="date"
            required
            min={bareme?.period.start}
            value={effectiveDue}
            onChange={(e) => setDueDate(e.target.value)}
            className={field}
          />
          <span className={hint}>{C.dueDateHint}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-amount">{C.amount}</Label>
          <Input
            id="note-amount"
            name="amountFc"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={blocked || undefined}
            className={`${field} font-mono`}
          />
          <span className={blocked ? warning : hint}>
            {blocked
              ? C.amountNoBase
              : baremeFc === null
                ? C.amountNoBareme
                : edited
                  ? `${C.amountBareme.replace("{amount}", formatFC(baremeFc))} · ${C.amountEdited}`
                  : C.amountBareme.replace("{amount}", formatFC(baremeFc))}
          </span>
          {late && amountInt !== null ? (
            <span className={`${warning} font-semibold`} data-testid="note-penalty">
              {late.penaltyFc > 0
                ? C.penaltyAtIssue
                    .replace("{late}", lateText(late.daysLate))
                    .replace("{penalty}", formatFC(late.penaltyFc))
                    .replace("{total}", formatFC(amountInt + late.penaltyFc))
                : C.penaltyAtIssueNone.replace("{late}", lateText(late.daysLate))}
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="note-label">{C.label}</Label>
          <Input
            id="note-label"
            name="label"
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={field}
          />
          <span className={hint}>{C.labelHint}</span>
        </div>
        {edited ? (
          <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
            <Label htmlFor="note-reason">{C.reason}</Label>
            <Textarea
              id="note-reason"
              name="reason"
              rows={2}
              minLength={5}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className={hint}>{C.reasonHint}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#5C5456]">
        <button
          type="submit"
          disabled={
            pending || blocked || beforeRegistration || !rule || !bareme || bareme.skipped !== null
          }
          className="h-11 rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50 md:h-9"
        >
          {pending ? C.submitting : C.submit}
        </button>
      </div>
    </form>
  );
}
