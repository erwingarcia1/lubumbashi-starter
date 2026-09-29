import type { Metadata } from "next";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

import "./globals.css";

// No font fetched at build time: `--font-sans` (globals.css) is Public Sans where the admin
// surface loads it and the system stack elsewhere, so an image can be built without internet.

export const metadata: Metadata = {
  title: t.app.title,
  description: t.app.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className="font-sans">
      <body className="bg-background text-foreground min-h-screen antialiased">{children}</body>
    </html>
  );
}
