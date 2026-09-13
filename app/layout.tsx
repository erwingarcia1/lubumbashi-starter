import type { Metadata } from "next";
import type { ReactNode } from "react";

import { t } from "@/lib/i18n";

import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: t.app.title,
  description: t.app.description,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={cn("font-sans", geist.variable)}>
      <body className="bg-background text-foreground min-h-screen antialiased">{children}</body>
    </html>
  );
}
