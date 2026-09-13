import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

export const metadata: Metadata = {
  title: `${t.agent.appName} · ${t.admin.brand}`,
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#C1121F", width: "device-width", initialScale: 1 };

/** Phone-first shell, light only (the prototype's frames), touch targets ≥ 48 px. */
export default function AgentRootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-[#F6F5F2] text-[#1B1B1F]">
      {children}
    </div>
  );
}
