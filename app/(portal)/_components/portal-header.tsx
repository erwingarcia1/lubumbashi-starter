import type { ReactNode } from "react";

export function PortalHeader({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 bg-[#C1121F] px-4 pt-3.5 pb-3 text-white">
      <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-white text-[13px] font-bold text-[#C1121F]">
        L
      </div>
      <div className="min-w-0">
        <div className="text-[15px] leading-tight font-bold">{title}</div>
        {subtitle ? <div className="text-[11px] opacity-85">{subtitle}</div> : null}
      </div>
    </div>
  );
}

export function KeyValueList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="text-[12.5px]">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="flex justify-between gap-2 border-b border-[#EFEAEA] py-1.5 last:border-0"
        >
          <span>{k}</span>
          <b className="text-right">{v}</b>
        </div>
      ))}
    </div>
  );
}
