import Link from "next/link";

import { agentsTable, canManageAgents, zonesForAgents } from "@/lib/admin/agents";
import { getDb } from "@/lib/db/client";
import { canViewTracking } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateTimeFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";
import { requestNow } from "@/lib/time";
import { formatKm, formatTimeFr } from "@/lib/tracking/format";

import { createAgentAction, resetAgentPinAction, revokeDeviceAction } from "../../_actions";
import { Banner } from "../../_components/banner";
import { Pill } from "../../_components/pill";

/** d-agents: failure rate and out-of-zone registrations, device revocation. */
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; matricule?: string }>;
}) {
  const [{ ok, error, matricule }, session] = await Promise.all([searchParams, requireAdmin()]);
  const db = getDb();
  // Field activity (D38) is read and shown only to the roles allowed to see the trail.
  const canTrack = canViewTracking(session.role);
  const [rows, communes] = await Promise.all([
    agentsTable(db, requestNow(), { withTracking: canTrack }),
    zonesForAgents(db),
  ]);
  const A = t.admin.agents;
  const T = t.admin.tracking;
  const canRevoke = canManageAgents(session.role);
  const abnormal = rows.filter((r) => r.attempts7d >= 5 && (r.failureRate7d ?? 0) > 30);
  const staleCutoff = requestNow().getTime() - 24 * 3_600_000;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{A.title}</h2>
      </div>
      <Banner
        ok={
          ok === "revoked"
            ? A.revokeDone
            : ok === "created"
              ? `${A.created}${matricule ? ` ${matricule}` : ""}`
              : ok === "pin"
                ? A.pinReset
                : undefined
        }
        error={error}
      />
      {canRevoke ? (
        <form
          action={createAgentAction}
          className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3"
        >
          <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">
            {A.newAgent}
          </p>
          <p className="mt-1 text-[12px] text-[#5C5456]">{A.newAgentHint}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
            <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
              {A.fullName}
              <input
                name="fullName"
                required
                minLength={3}
                className="h-11 w-full rounded-md border border-[#D5CFCF] px-2 text-base text-[#1B1B1F] md:h-9 md:w-56 md:text-[12.5px]"
              />
            </label>
            <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
              {A.phone}
              <input
                name="phone"
                inputMode="tel"
                pattern="^\+[1-9][0-9]{6,14}$"
                className="h-11 w-full rounded-md border border-[#D5CFCF] px-2 font-mono text-base text-[#1B1B1F] md:h-9 md:w-44 md:text-[12.5px]"
              />
            </label>
            <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
              {A.quartier}
              <select
                name="quartierId"
                required
                className="h-11 w-full rounded-md border border-[#D5CFCF] bg-white px-2 text-base text-[#1B1B1F] md:h-9 md:w-auto md:text-[12.5px]"
              >
                {communes.flatMap((c) =>
                  c.quartiers.map((q) => (
                    <option key={q.id} value={q.id}>
                      {c.name} · {q.name}
                    </option>
                  )),
                )}
              </select>
            </label>
            <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
              {A.pin}
              <input
                name="pin"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                className="h-11 w-full rounded-md border border-[#D5CFCF] px-2 font-mono text-base text-[#1B1B1F] md:h-9 md:w-28 md:text-[12.5px]"
              />
            </label>
            <button
              type="submit"
              className="h-11 w-full rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white md:h-9 md:w-auto"
            >
              {A.create}
            </button>
          </div>
        </form>
      ) : null}
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
                    {canRevoke ? (
                      <form action={resetAgentPinAction} className="mt-1 flex items-center gap-1">
                        <input type="hidden" name="agentId" value={r.id} />
                        <input
                          name="pin"
                          required
                          inputMode="numeric"
                          pattern="[0-9]{6}"
                          maxLength={6}
                          placeholder={A.newPin}
                          aria-label={`${A.newPin} ${r.matricule}`}
                          className="h-11 w-32 rounded-md border border-[#D5CFCF] px-1.5 font-mono text-base md:h-7 md:w-24 md:text-[11.5px]"
                        />
                        <button
                          type="submit"
                          className="h-11 rounded-md border border-[#D5CFCF] bg-white px-2 text-[11px] font-semibold whitespace-nowrap md:h-7"
                        >
                          {A.resetPin}
                        </button>
                      </form>
                    ) : null}
                  </td>
                  <td className="px-2.5 py-2">
                    {r.zone}
                    {canTrack && r.today ? (
                      <>
                        <br />
                        <Link
                          href={`/admin/agents/${r.matricule}`}
                          className="inline-block min-h-11 py-2.5 font-semibold text-[#C1121F] underline md:min-h-0 md:py-0"
                        >
                          {T.link}
                        </Link>
                        <span className="block text-[11.5px] whitespace-nowrap text-[#5C5456]">
                          {T.snippet.today}{" "}
                          {r.today.lastSeenAt
                            ? `${T.snippet.lastSeen} ${formatTimeFr(r.today.lastSeenAt)} · ${formatKm(r.today.distanceM)} · ${r.today.acts} ${T.snippet.acts}`
                            : T.snippet.none}
                        </span>
                      </>
                    ) : null}
                  </td>
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
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {rows.flatMap((r) =>
            r.devices.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 overflow-hidden rounded-md border border-[#EFEAEA] px-3 py-2 text-[12.5px]"
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
                  <form
                    action={revokeDeviceAction}
                    className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto"
                  >
                    <input type="hidden" name="deviceId" value={d.id} />
                    <input
                      name="reason"
                      placeholder={A.revokeReason}
                      required
                      minLength={3}
                      className="h-11 min-w-0 flex-1 rounded-md border border-[#D5CFCF] px-2 text-base md:h-8 md:flex-none md:text-[12px]"
                    />
                    <button
                      type="submit"
                      className="h-11 flex-none rounded-md bg-[#C1121F] px-3 text-[12px] font-semibold text-white md:h-8"
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
