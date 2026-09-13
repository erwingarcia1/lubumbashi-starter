import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApprovalPolicy } from "@/lib/admin/settings";
import { getRuleWithVersions, versionInForce } from "@/lib/admin/taxes";
import { getDb } from "@/lib/db/client";
import { admins } from "@/lib/db/schema";
import { canApproveRuleVersion, canProposeRuleVersion } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { businessDate } from "@/lib/time";

import { approveVersionAction, proposeVersionAction } from "../../../_actions";
import { Banner } from "../../../_components/banner";
import { Pill } from "../../../_components/pill";

export default async function TaxRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ code }, { ok, error }, session] = await Promise.all([
    params,
    searchParams,
    requireAdmin(),
  ]);
  const db = getDb();
  const data = await getRuleWithVersions(db, code);
  if (!data) notFound();
  const policy = await getApprovalPolicy(db);
  const today = businessDate(new Date());
  const current = versionInForce(data.versions, today);
  const people = await db.select({ id: admins.id, fullName: admins.fullName }).from(admins);
  const nameOf = (id: string | null) =>
    id ? (people.find((p) => p.id === id)?.fullName ?? id) : t.common.none;
  const latest = data.versions[0];
  const editable = latest?.calcKind === "fixed" && canProposeRuleVersion(session.role);
  const okMessage =
    ok === "proposed"
      ? t.admin.taxes.proposed
      : ok === "approved"
        ? t.admin.taxes.approved
        : undefined;
  const nextMonth = (() => {
    const [y, m] = today.split("-").map(Number) as [number, number, number];
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, "0")}-01`;
  })();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/taxes" className="text-[12.5px] text-[#C1121F] underline">
          ← {t.common.back}
        </Link>
        <h2 className="text-lg font-bold">
          {data.rule.labelFr} · {data.categoryLabel}
        </h2>
        {current ? (
          <Pill tone="ok">{t.status.version.approved}</Pill>
        ) : (
          <Pill tone="n">{t.admin.taxes.noVersion}</Pill>
        )}
      </div>
      <Banner ok={okMessage} error={error} />
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
                {[
                  t.admin.taxes.version,
                  t.admin.taxes.amount,
                  t.admin.taxes.penaltyRate,
                  t.admin.taxes.current,
                  t.admin.taxes.end,
                  t.admin.taxes.columns.status,
                  t.admin.taxes.proposedBy,
                  t.admin.taxes.approvedBy,
                  "",
                ].map((h, i) => (
                  <th key={i} className="border-b border-[#D5CFCF] px-2.5 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v) => {
                const verdict =
                  v.status === "draft"
                    ? canApproveRuleVersion(
                        policy,
                        { adminId: session.adminId, role: session.role },
                        v,
                      )
                    : null;
                const tone =
                  v.status === "draft"
                    ? "n"
                    : current?.id === v.id
                      ? "ok"
                      : v.status === "approved" && v.effectiveFrom > today
                        ? "warn"
                        : "n";
                const label =
                  v.status === "draft"
                    ? t.status.version.draft
                    : current?.id === v.id
                      ? t.status.version.approved
                      : v.status === "approved" && v.effectiveFrom > today
                        ? t.status.version.upcoming
                        : t.status.version.superseded;
                return (
                  <tr key={v.id} className="border-b border-[#EFEAEA]">
                    <td className="px-2.5 py-2 font-mono">v{v.version}</td>
                    <td className="px-2.5 py-2 font-mono">
                      {v.calcKind === "fixed"
                        ? formatFC(v.amountFc ?? 0)
                        : `${(v.rateBp ?? 0) / 100} %`}
                    </td>
                    <td className="px-2.5 py-2">
                      {v.penaltyKind === "none"
                        ? t.common.none
                        : `${(v.penaltyRateBp ?? 0) / 100} % · ${v.graceDays} ${t.admin.taxes.days}`}
                    </td>
                    <td className="px-2.5 py-2 font-mono">{formatDateFr(v.effectiveFrom)}</td>
                    <td className="px-2.5 py-2 font-mono">
                      {v.effectiveTo ? formatDateFr(v.effectiveTo) : t.common.none}
                    </td>
                    <td className="px-2.5 py-2">
                      <Pill tone={tone}>{label}</Pill>
                    </td>
                    <td className="px-2.5 py-2">{nameOf(v.proposedByAdminId)}</td>
                    <td className="px-2.5 py-2">{nameOf(v.approvedByAdminId)}</td>
                    <td className="px-2.5 py-2">
                      {v.status === "draft" && verdict?.ok ? (
                        <form action={approveVersionAction}>
                          <input type="hidden" name="ruleCode" value={data.rule.code} />
                          <input type="hidden" name="versionId" value={v.id} />
                          <Button type="submit" size="sm">
                            {t.admin.taxes.approve}
                          </Button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {t.admin.taxes.editTitle} · {data.rule.labelFr} · {data.categoryLabel}
          </p>
          {editable ? (
            <form action={proposeVersionAction} className="mt-2 flex flex-col gap-2.5">
              <input type="hidden" name="ruleCode" value={data.rule.code} />
              <div className="flex flex-col gap-1">
                <Label htmlFor="amountFc">{t.admin.taxes.amount} (FC)</Label>
                <Input
                  id="amountFc"
                  name="amountFc"
                  type="number"
                  min={0}
                  step={1}
                  required
                  defaultValue={latest?.amountFc ?? 0}
                  className="font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label>{t.admin.taxes.frequency}</Label>
                  <Input
                    value={latest ? t.admin.taxes.frequencyLabels[latest.frequency] : ""}
                    readOnly
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>{t.admin.taxes.dueDate}</Label>
                  <Input value={t.admin.taxes.lastDayOfPeriod} readOnly />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="penaltyPct">{t.admin.taxes.penaltyRate} (%)</Label>
                  <Input
                    id="penaltyPct"
                    name="penaltyPct"
                    type="number"
                    min={0}
                    step={0.5}
                    defaultValue={latest?.penaltyRateBp != null ? latest.penaltyRateBp / 100 : ""}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="graceDays">
                    {t.admin.taxes.after} ({t.admin.taxes.days})
                  </Label>
                  <Input
                    id="graceDays"
                    name="graceDays"
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={latest?.graceDays ?? 30}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t.admin.taxes.exemptions}</Label>
                <p className="text-[12px] text-[#5C5456]">{t.admin.taxes.exemptionsNote}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="effectiveFrom">{t.admin.taxes.newVersionFrom}</Label>
                <Input
                  id="effectiveFrom"
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={nextMonth}
                  min={today}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="referenceDocument">{t.admin.taxes.reference}</Label>
                <Input id="referenceDocument" name="referenceDocument" maxLength={200} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="notesFr">{t.admin.taxes.notes}</Label>
                <Textarea id="notesFr" name="notesFr" rows={2} maxLength={1000} />
              </div>
              <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
                {t.admin.taxes.versionNotice}
              </div>
              <Button type="submit" size="sm" className="self-start">
                {t.admin.taxes.submit}
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-[12.5px] text-[#5C5456]">
              {latest?.calcKind === "fixed" ? t.admin.errors.forbidden : t.admin.taxes.onlyFixed}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
