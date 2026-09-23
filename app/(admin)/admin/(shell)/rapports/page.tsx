import { canIssueInvoice } from "@/lib/identity/roles";
import { requireAdmin } from "@/lib/identity/session";
import { t } from "@/lib/i18n";
import { REPORT_CODES, REPORTS } from "@/lib/reports";
import { businessDate, requestNow } from "@/lib/time";

const R = t.admin.reports;

/** Mobile: 44 px controls that fill the row; ≥md: the original 32 px inline controls. */
const fieldCls =
  "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 text-base text-[#1B1B1F] md:h-8 md:w-auto md:text-[12.5px]";
const labelCls = "flex min-w-0 grow flex-col text-[#5C5456] md:grow-0";

/** d-reports: each report is a registry entry (lib/reports); "Générer" downloads the file. */
export default async function ReportsPage() {
  const session = await requireAdmin();
  const today = businessDate(requestNow());
  const month = today.slice(0, 7);
  const yesterday = businessDate(new Date(requestNow().getTime() - 86_400_000));
  const canAudit = ["auditeur", "administrateur", "maire"].includes(session.role);
  // The print run of the notes de perception issues them: same roles as the single note.
  const canInvoices = canIssueInvoice(session.role);
  return (
    <>
      <h2 className="text-lg font-bold">{R.title}</h2>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        {REPORT_CODES.map((code) => {
          const def = REPORTS[code];
          const item = R.items[code];
          const disabled = (code === "audit" && !canAudit) || (code === "invoices" && !canInvoices);
          return (
            <form
              key={code}
              method="get"
              action={`/api/v1/admin/reports/${code}`}
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3"
            >
              <div className="min-w-0 break-words">
                <b className="text-[14px]">{item.label}</b>
                <div className="text-[12.5px] text-[#5C5456]">{item.body}</div>
              </div>
              <div className="flex min-w-0 flex-wrap items-end gap-2 text-[12.5px]">
                {def.param === "month" ? (
                  <label className={labelCls}>
                    {R.period}
                    <input
                      type="month"
                      name="month"
                      defaultValue={month}
                      max={month}
                      className={fieldCls}
                    />
                  </label>
                ) : null}
                {def.param === "day" ? (
                  <label className={labelCls}>
                    {R.day}
                    <input
                      type="date"
                      name="day"
                      defaultValue={yesterday}
                      max={today}
                      className={fieldCls}
                    />
                  </label>
                ) : null}
                <label className={labelCls}>
                  {R.format}
                  <select name="format" defaultValue={def.formats[0]} className={fieldCls}>
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
                  className="h-11 grow rounded-md bg-[#C1121F] px-3 font-semibold text-white disabled:opacity-50 md:h-8 md:grow-0"
                >
                  {R.generate}
                </button>
                {disabled ? (
                  <span className="basis-full text-[#5C5456] md:basis-auto md:self-center">
                    {t.admin.errors.forbidden}
                  </span>
                ) : null}
              </div>
            </form>
          );
        })}
      </div>
    </>
  );
}
