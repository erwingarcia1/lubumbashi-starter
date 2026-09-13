import { auditJournal, type AuditFilters } from "@/lib/admin/audit";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { formatDateTimeFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

const A = t.admin.audit;

function actionLabel(action: string): string {
  const known = t.admin.auditActions as Record<string, string | undefined>;
  return known[action] ?? action;
}

/** d-audit: WHO + WHAT + WHEN + WHERE + DEVICE, append-only, filters, CSV export. */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [q] = await Promise.all([searchParams, requireAdmin()]);
  const filters: AuditFilters = {
    from: q.from || undefined,
    to: q.to || undefined,
    actor: q.actor || undefined,
    action: q.action || undefined,
    object: q.object || undefined,
    limit: Math.min(Number(q.limit ?? 100) || 100, 1000),
  };
  const { rows, total } = await auditJournal(getDb(), filters);
  const query = new URLSearchParams(
    Object.entries({ from: q.from, to: q.to, actor: q.actor, action: q.action, object: q.object })
      .filter((e): e is [string, string] => !!e[1])
      .map(([k, v]) => [k, v]),
  );
  const roleLabel = (r: string | null) =>
    r && r in t.roles
      ? t.roles[r as keyof typeof t.roles]
      : r === "agent"
        ? t.status.origin.agent
        : (r ?? t.common.none);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{A.title}</h2>
        <span className="text-[12.5px] text-[#5C5456]">{A.subtitle}</span>
        <a
          href={`/api/v1/admin/reports/audit?format=csv&${query.toString()}`}
          className="ml-auto h-8 rounded-md border border-[#D5CFCF] bg-white px-3 text-[12.5px] leading-8 font-semibold"
        >
          {A.export}
        </a>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2 text-[12.5px]">
        {(
          [
            ["from", A.filters.from, "date"],
            ["to", A.filters.to, "date"],
            ["actor", A.filters.actor, "text"],
            ["action", A.filters.action, "text"],
            ["object", A.filters.object, "text"],
          ] as const
        ).map(([name, label, type]) => (
          <label key={name} className="flex flex-col gap-0.5 text-[#5C5456]">
            {label}
            <input
              name={name}
              type={type}
              defaultValue={q[name] ?? ""}
              className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2 text-[#1B1B1F]"
            />
          </label>
        ))}
        <button type="submit" className="h-8 rounded-md bg-[#C1121F] px-3 font-semibold text-white">
          {A.filters.apply}
        </button>
        <a href="/admin/audit" className="h-8 leading-8 text-[#5C5456] underline">
          {A.filters.reset}
        </a>
        <span className="ml-auto text-[#5C5456]">{A.count.replace("{n}", String(total))}</span>
      </form>
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[
                A.columns.at,
                A.columns.who,
                A.columns.role,
                A.columns.action,
                A.columns.object,
                A.columns.where,
                A.columns.device,
              ].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-3 text-[#5C5456]">
                  {A.empty}
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[#EFEAEA] align-top">
                <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">
                  {formatDateTimeFr(r.at)}
                </td>
                <td className="px-2.5 py-1.5">
                  {r.actorType === "system" ? A.system : (r.actorLabel ?? t.common.none)}
                </td>
                <td className="px-2.5 py-1.5">
                  {r.actorType === "system" ? t.common.none : roleLabel(r.actorRole)}
                </td>
                <td className="px-2.5 py-1.5">
                  {actionLabel(r.action)}
                  {r.reason ? <div className="text-[11px] text-[#5C5456]">{r.reason}</div> : null}
                </td>
                <td className="px-2.5 py-1.5 font-mono">{r.objectId}</td>
                <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">
                  {r.gps
                    ? `${r.gps.y.toFixed(4)}, ${r.gps.x.toFixed(4)}`
                    : r.ip
                      ? `${A.office} · ${r.ip}`
                      : t.common.none}
                </td>
                <td className="px-2.5 py-1.5">
                  {r.deviceCode ??
                    (r.userAgent
                      ? r.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 40)
                      : r.actorType === "system"
                        ? "job"
                        : t.common.none)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length < total ? (
        <a
          href={`/admin/audit?${query.toString()}&limit=${Math.min(filters.limit! * 2, 1000)}`}
          className="text-[12.5px] text-[#5C5456] underline"
        >
          {A.more.replace("{n}", String(Math.min(filters.limit!, total - rows.length)))}
        </a>
      ) : null}
      <p className="text-[12px] text-[#5C5456]">{A.appendOnly}</p>
    </>
  );
}
