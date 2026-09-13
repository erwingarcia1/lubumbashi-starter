import { agentsTable } from "@/lib/admin/agents";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateTimeFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { requestNow } from "@/lib/time";

import { revokeDeviceAction } from "../../_actions";
import { Banner } from "../../_components/banner";
import { Pill } from "../../_components/pill";

/** d-agents: failure rate and out-of-zone registrations, device revocation. */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ ok, error }, session] = await Promise.all([searchParams, requireAdmin()]);
  const rows = await agentsTable(getDb());
  const A = t.admin.agents;
  const canRevoke = session.role === "administrateur" || session.role === "superviseur";
  const abnormal = rows.filter((r) => r.attempts7d >= 5 && (r.failureRate7d ?? 0) > 30);
  const staleCutoff = requestNow().getTime() - 24 * 3_600_000;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{A.title}</h2>
      </div>
      <Banner ok={ok === "revoked" ? A.revokeDone : undefined} error={error} />
      {abnormal.map((r) => (
        <div
          key={r.id}
          className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]"
        >
          ⚠{" "}
          <b>
            {r.matricule} · {r.fullName}
          </b>{" "}
          : {r.failureRate7d} % {A.alert}. {r.outOfZone} {A.outOfZone}.
        </div>
      ))}
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{A.columns.agent}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{A.columns.zone}</th>
              {[
                A.columns.registered,
                A.columns.collections,
                A.columns.amount,
                A.columns.failure,
                A.columns.duplicates,
              ].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2 text-right">
                  {h}
                </th>
              ))}
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{A.columns.lastSync}</th>
              <th className="border-b border-[#D5CFCF] px-2.5 py-2">{A.columns.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.attempts7d >= 5 && (r.failureRate7d ?? 0) > 30;
              const stale = !r.lastSeenAt || r.lastSeenAt.getTime() < staleCutoff;
              return (
                <tr key={r.id} className="border-b border-[#EFEAEA] align-top">
                  <td className="px-2.5 py-2">
                    <span className="font-mono">{r.matricule}</span>
                    <br />
                    {r.fullName}
                  </td>
                  <td className="px-2.5 py-2">{r.zone}</td>
                  <td className="px-2.5 py-2 text-right font-mono">{r.registered}</td>
                  <td className="px-2.5 py-2 text-right font-mono">{r.collections}</td>
                  <td className="px-2.5 py-2 text-right font-mono">{formatFC(r.amountFc)}</td>
                  <td className={`px-2.5 py-2 text-right font-mono ${bad ? "text-bad" : ""}`}>
                    {r.failureRate7d === null ? t.common.none : `${r.failureRate7d} %`}
                  </td>
                  <td className="px-2.5 py-2 text-right font-mono">
                    {r.duplicates}
                    {r.outOfZone ? ` · ${r.outOfZone} ⚑` : ""}
                  </td>
                  <td className="px-2.5 py-2 font-mono">
                    {r.lastSeenAt ? formatDateTimeFr(r.lastSeenAt) : A.never}
                  </td>
                  <td className="px-2.5 py-2">
                    {r.status === "suspended" ? (
                      <Pill tone="n">{A.statuses.suspended}</Pill>
                    ) : bad ? (
                      <Pill tone="bad">{A.statuses.bad}</Pill>
                    ) : stale ? (
                      <Pill tone="warn">{A.statuses.warn}</Pill>
                    ) : (
                      <Pill tone="ok">{A.statuses.ok}</Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-[#E3DEDE] bg-white p-3.5">
        <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{A.devices}</p>
        <p className="mt-1 text-[12.5px] text-[#5C5456]">
          {rows.reduce((s, r) => s + r.devices.length, 0)} {A.devicesNote} ·{" "}
          {rows.reduce((s, r) => s + r.devices.filter((d) => d.status === "revoked").length, 0)}{" "}
          {A.revoked}
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {rows.flatMap((r) =>
            r.devices.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-[#EFEAEA] px-3 py-2 text-[12.5px]"
              >
                <span className="font-mono font-semibold">{d.code}</span>
                <span>{d.label ?? t.common.none}</span>
                <span className="font-mono text-[#5C5456]">{r.matricule}</span>
                <Pill tone={d.status === "active" ? "ok" : "bad"}>
                  {d.status === "active"
                    ? A.active
                    : `${A.revoked}${d.revokedReason ? ` · ${d.revokedReason}` : ""}`}
                </Pill>
                {canRevoke && d.status === "active" ? (
                  <form action={revokeDeviceAction} className="ml-auto flex items-center gap-1.5">
                    <input type="hidden" name="deviceId" value={d.id} />
                    <input
                      name="reason"
                      placeholder={A.revokeReason}
                      required
                      minLength={3}
                      className="h-8 rounded-md border border-[#D5CFCF] px-2 text-[12px]"
                    />
                    <button
                      type="submit"
                      className="h-8 rounded-md bg-[#C1121F] px-3 text-[12px] font-semibold text-white"
                    >
                      {A.revoke}
                    </button>
                  </form>
                ) : null}
              </div>
            )),
          )}
        </div>
      </div>
    </>
  );
}
