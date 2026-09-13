import type { ReactNode } from "react";

// Self-hosted fonts of the prototype (OFL, shipped through node_modules): admin surface only.
import "@fontsource-variable/public-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#F6F5F2] font-sans text-[#1B1B1F]">{children}</div>;
}
