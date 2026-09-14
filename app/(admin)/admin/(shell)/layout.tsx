import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/identity/session";
import { t } from "@/lib/i18n";

import { signOutAction } from "../_actions";
import { AdminShell } from "../_components/admin-shell";
import { SideNav, type NavItem } from "../_components/side-nav";

const NAV: NavItem[] = [
  { key: "overview", label: t.admin.nav.overview, href: "/admin", live: true },
  {
    key: "collections",
    label: t.admin.nav.collections,
    href: "/admin/recettes",
    live: true,
  },
  { key: "map", label: t.admin.nav.map, href: "/admin/carte", live: true },
  { key: "taxpayers", label: t.admin.nav.taxpayers, href: "/admin/contribuables", live: true },
  { key: "agents", label: t.admin.nav.agents, href: "/admin/agents", live: true },
  {
    key: "reconciliation",
    label: t.admin.nav.reconciliation,
    href: "/admin/rapprochement",
    live: true,
  },
  { key: "taxes", label: t.admin.nav.taxes, href: "/admin/taxes", live: true },
  { key: "audit", label: t.admin.nav.audit, href: "/admin/audit", live: true },
  { key: "reports", label: t.admin.nav.reports, href: "/admin/rapports", live: true },
  { key: "settings", label: t.admin.nav.settings, href: "/admin/reglages", live: true },
];

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await requireAdmin();
  const brand = (
    <div className="flex min-w-0 items-center gap-2">
      <div className="grid h-7 w-7 flex-none place-items-center rounded-full bg-[#C1121F] text-xs font-bold text-white">
        L
      </div>
      <div className="min-w-0">
        <b className="block truncate text-[13px] leading-tight">{t.admin.brand}</b>
        <small className="block truncate text-[10.5px] text-[#A79C9E]">{t.admin.brandSub}</small>
      </div>
    </div>
  );
  return (
    <AdminShell
      brand={brand}
      labels={{ open: t.admin.menuOpen, close: t.admin.menuClose }}
      aside={
        <>
          <SideNav items={NAV} />
          <div className="mt-auto border-t border-[#3A2F31] px-2.5 pt-2.5 text-[11px] text-[#A79C9E]">
            {t.admin.connectedAs} {session.fullName}
            <br />
            {t.admin.role} {t.roles[session.role]}
            <form action={signOutAction} className="mt-2">
              <button
                type="submit"
                className="min-h-11 text-[11px] text-[#CFC5C7] underline md:min-h-0"
              >
                {t.admin.signOut}
              </button>
            </form>
          </div>
        </>
      }
    >
      {children}
    </AdminShell>
  );
}
