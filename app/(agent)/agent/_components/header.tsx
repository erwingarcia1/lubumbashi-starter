import type { ReactNode } from "react";

export function AgentHeader({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-[#C1121F] px-4 pt-3.5 pb-3 text-white">
      <div className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-white text-[13px] font-bold text-[#C1121F]">
        L
      </div>
      <div className="min-w-0">
        <div className="text-[15px] leading-tight font-bold">{title}</div>
        {subtitle ? <div className="text-[11px] opacity-85">{subtitle}</div> : null}
      </div>
      {right ? <div className="ml-auto text-right text-[11px] opacity-90">{right}</div> : null}
    </div>
  );
}
