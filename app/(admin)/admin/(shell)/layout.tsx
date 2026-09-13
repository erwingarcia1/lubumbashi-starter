import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/identity/session";
import { t } from "@/lib/i18n";

import { signOutAction } from "../_actions";
import { SideNav, type NavItem } from "../_components/side-nav";

const NAV: NavItem[] = [
  { key: "overview", label: t.admin.nav.overview, href: "/admin/bientot/overview", live: false },
  {
    key: "collections",
    label: t.admin.nav.collections,
    href: "/admin/bientot/collections",
    live: false,
  },
  { key: "map", label: t.admin.nav.map, href: "/admin/bientot/map", live: false },
  { key: "taxpayers", label: t.admin.nav.taxpayers, href: "/admin/contribuables", live: true },
  { key: "agents", label: t.admin.nav.agents, href: "/admin/bientot/agents", live: false },
  {
    key: "reconciliation",
    label: t.admin.nav.reconciliation,
    href: "/admin/bientot/reconciliation",
    live: false,
  },
  { key: "taxes", label: t.admin.nav.taxes, href: "/admin/taxes", live: true },
  { key: "audit", label: t.admin.nav.audit, href: "/admin/bientot/audit", live: false },
  { key: "reports", label: t.admin.nav.reports, href: "/admin/bientot/reports", live: false },
];

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-[210px] flex-none flex-col gap-0.5 bg-[#1F1718] px-2.5 py-3.5 text-[#E9E2E3]">
        <div className="mb-2 flex items-center gap-2 border-b border-[#3A2F31] px-2 pt-1 pb-3.5">
          <div className="grid h-7 w-7 place-items-center rounded-full bg-[#C1121F] text-xs font-bold text-white">
            L
          </div>
          <div>
            <b className="block text-[13px] leading-tight">{t.admin.brand}</b>
            <small className="text-[10.5px] text-[#A79C9E]">{t.admin.brandSub}</small>
          </div>
        </div>
        <SideNav items={NAV} />
        <div className="mt-auto border-t border-[#3A2F31] px-2.5 pt-2.5 text-[11px] text-[#A79C9E]">
          {t.admin.connectedAs} {session.fullName}
          <br />
          {t.admin.role} {t.roles[session.role]}
          <form action={signOutAction} className="mt-2">
            <button type="submit" className="text-[11px] text-[#CFC5C7] underline">
              {t.admin.signOut}
            </button>
          </form>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 px-6 py-4">{children}</main>
    </div>
  );
}
