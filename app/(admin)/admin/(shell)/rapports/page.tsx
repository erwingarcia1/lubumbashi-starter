import { requireAdmin } from "@/lib/identity/session";
import { t } from "@/lib/i18n";
import { REPORT_CODES, REPORTS } from "@/lib/reports";
import { businessDate, requestNow } from "@/lib/time";

const R = t.admin.reports;

/** d-reports: each report is a registry entry (lib/reports); "Générer" downloads the file. */
export default async function ReportsPage() {
  const session = await requireAdmin();
  const today = businessDate(requestNow());
  const month = today.slice(0, 7);
  const yesterday = businessDate(new Date(requestNow().getTime() - 86_400_000));
  const canAudit = ["auditeur", "administrateur", "maire"].includes(session.role);
  return (
    <>
      <h2 className="text-lg font-bold">{R.title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {REPORT_CODES.map((code) => {
          const def = REPORTS[code];
          const item = R.items[code];
          const disabled = code === "audit" && !canAudit;
          return (
            <form
              key={code}
              method="get"
              action={`/api/v1/admin/reports/${code}`}
              className="flex flex-col gap-2 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3"
            >
              <div>
                <b className="text-[14px]">{item.label}</b>
                <div className="text-[12.5px] text-[#5C5456]">{item.body}</div>
              </div>
              <div className="flex flex-wrap items-end gap-2 text-[12.5px]">
                {def.param === "month" ? (
                  <label className="flex flex-col text-[#5C5456]">
                    {R.period}
                    <input
                      type="month"
                      name="month"
                      defaultValue={month}
                      max={month}
                      className="h-8 rounded-md border border-[#D5CFCF] px-2 text-[#1B1B1F]"
                    />
                  </label>
                ) : null}
                {def.param === "day" ? (
                  <label className="flex flex-col text-[#5C5456]">
                    {R.day}
                    <input
                      type="date"
                      name="day"
                      defaultValue={yesterday}
                      max={today}
                      className="h-8 rounded-md border border-[#D5CFCF] px-2 text-[#1B1B1F]"
                    />
                  </label>
                ) : null}
                <label className="flex flex-col text-[#5C5456]">
                  Format
                  <select
                    name="format"
                    defaultValue={def.formats[0]}
                    className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2 text-[#1B1B1F]"
                  >
                    {def.formats.map((f) => (
                      <option key={f} value={f}>
                        {R.formats[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={disabled}
                  className="h-8 rounded-md bg-[#C1121F] px-3 font-semibold text-white disabled:opacity-50"
                >
                  {R.generate}
                </button>
                {disabled ? (
                  <span className="text-[#5C5456]">{t.admin.errors.forbidden}</span>
                ) : null}
              </div>
            </form>
          );
        })}
      </div>
    </>
  );
}
