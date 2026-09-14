"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  live: boolean;
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href as never}
            className={`block rounded-md px-2.5 py-3 text-[14px] md:py-2 md:text-[13px] ${active ? "bg-[#C1121F] font-semibold text-white" : "text-[#CFC5C7] hover:bg-[#2A2224]"} ${item.live ? "" : "opacity-60"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
