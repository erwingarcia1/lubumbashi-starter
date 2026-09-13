"use client";

import type { ReactNode } from "react";

/** GET filter form that applies as soon as a select changes; the button stays for keyboards and no-JS. */
export function MapFilters({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form method="get" className={className} onChange={(e) => e.currentTarget.requestSubmit()}>
      {children}
    </form>
  );
}
