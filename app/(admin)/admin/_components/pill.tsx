import type { ReactNode } from "react";

const styles = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-[#8A5A12]",
  bad: "bg-bad-soft text-bad",
  n: "bg-[#ECE7E7] text-[#5C5456]",
  blue: "bg-[#E1E8F7] text-[#2F4CA3]",
} as const;

export type PillTone = keyof typeof styles;

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  );
}
