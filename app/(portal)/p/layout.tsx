import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: `${t.portal.brand} · ${t.receipt.city}` };
export const viewport: Viewport = { themeColor: "#C1121F", width: "device-width", initialScale: 1 };

/** Phone-first, light only, touch targets ≥ 48 px (CLAUDE.md). */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      {children}
    </div>
  );
}
