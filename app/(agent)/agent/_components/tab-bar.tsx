"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { t } from "@/lib/i18n";

const TABS = [
  { href: "/agent", icon: "🏠", label: t.agent.tabs.home },
  { href: "/agent/recenser", icon: "➕", label: t.agent.tabs.register },
  { href: "/agent/scanner", icon: "▦", label: t.agent.tabs.scan },
  { href: "/agent/sync", icon: "⇅", label: t.agent.tabs.sync },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="sticky bottom-0 flex border-t border-[#E3DEDE] bg-white">
      {TABS.map((tab) => {
        const on = tab.href === "/agent" ? pathname === "/agent" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center py-2 text-[10.5px] font-semibold ${on ? "text-[#C1121F]" : "text-[#8E8688]"}`}
          >
            <span aria-hidden="true" className="text-lg leading-tight">
              {tab.icon}
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
