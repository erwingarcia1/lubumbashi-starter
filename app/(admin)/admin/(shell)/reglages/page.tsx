import { listAdminUsers } from "@/lib/admin/users";
import { getDb } from "@/lib/db/client";
import { requireAdmin } from "@/lib/identity/session";
import { ADMIN_ROLES } from "@/lib/identity/roles";
import { formatDateFr } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { createAdminUserAction, setAdminActiveAction, setAdminRoleAction } from "../../_actions";
import { Banner } from "../../_components/banner";
import { Pill } from "../../_components/pill";
import { NewUserForm } from "./new-user-form";

const S = t.admin.settings;

/** Réglages: the Mairie's own users (Administrateur only). Agents are managed under Agents. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ ok, error }, session] = await Promise.all([
    searchParams,
    requireAdmin(["administrateur"]),
  ]);
  const users = await listAdminUsers(getDb());
  return (
    <>
      <h2 className="text-lg font-bold">{S.title}</h2>
      <Banner
        ok={ok === "role" ? S.roleChanged : ok === "active" ? S.activeChanged : undefined}
        error={error}
      />
      <NewUserForm action={createAdminUserAction} />
      <div className="overflow-x-auto rounded-lg border border-[#E3DEDE] bg-white">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] tracking-wider text-[#5C5456] uppercase">
              {[S.email, S.fullName, S.role, S.status, S.since, t.common.actions].map((h) => (
                <th key={h} className="border-b border-[#D5CFCF] px-2.5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[#EFEAEA] align-middle">
                <td className="px-2.5 py-2 font-mono">{u.email}</td>
                <td className="px-2.5 py-2">{u.fullName}</td>
                <td className="px-2.5 py-2">
                  {u.id === session.adminId ? (
                    t.roles[u.role]
                  ) : (
                    <form action={setAdminRoleAction} className="flex items-center gap-1">
                      <input type="hidden" name="adminId" value={u.id} />
                      <select
                        name="role"
                        defaultValue={u.role}
                        aria-label={`${S.role} ${u.email}`}
                        className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2"
                      >
                        {ADMIN_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t.roles[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="h-8 rounded-md border border-[#D5CFCF] bg-white px-2 text-[11.5px] font-semibold"
                      >
                        {S.changeRole}
                      </button>
                    </form>
                  )}
                </td>
                <td className="px-2.5 py-2">
                  <Pill tone={u.active ? "ok" : "bad"}>{u.active ? S.active : S.disabled}</Pill>
                  {!u.linked ? (
                    <span className="ml-1 text-[11px] text-[#5C5456]">{S.notLinked}</span>
                  ) : null}
                </td>
                <td className="px-2.5 py-2 font-mono">{formatDateFr(u.createdAt)}</td>
                <td className="px-2.5 py-2">
                  {u.id === session.adminId ? (
                    <span className="text-[11.5px] text-[#5C5456]">{S.you}</span>
                  ) : (
                    <form action={setAdminActiveAction}>
                      <input type="hidden" name="adminId" value={u.id} />
                      <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                      <button
                        type="submit"
                        className={`h-8 rounded-md px-2.5 text-[11.5px] font-semibold ${u.active ? "bg-[#C1121F] text-white" : "border border-[#D5CFCF] bg-white"}`}
                      >
                        {u.active ? S.disable : S.enable}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-[#5C5456]">{S.note}</p>
    </>
  );
}
