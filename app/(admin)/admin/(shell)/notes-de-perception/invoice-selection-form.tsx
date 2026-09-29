"use client";

import { useState, type ReactNode } from "react";

/**
 * Plain GET form to the combined-notes PDF route, opened in a new tab. The rows (server-rendered
 * children) carry one nameless checkbox per obligation, `data-obligation=<id>`, all checked by
 * default; the ids of the checked ones travel as ONE comma-joined `obligations` field, which is
 * rebuilt from the DOM at every change. Without JavaScript the field keeps its initial value: all
 * the obligations listed.
 */
export function InvoiceSelectionForm({
  action,
  ids,
  labels,
  children,
}: {
  action: string;
  ids: readonly string[];
  labels: { generate: string; opensInTab: string; selectAtLeastOne: string; selected: string };
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<readonly string[]>(ids);
  const none = selected.length === 0;
  return (
    <form
      method="get"
      action={action}
      target="_blank"
      className="flex min-w-0 flex-col gap-3"
      onChange={(e) => {
        const boxes = e.currentTarget.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"][data-obligation]',
        );
        setSelected(
          Array.from(boxes)
            .filter((box) => box.checked)
            .map((box) => box.dataset.obligation ?? "")
            .filter((id) => id.length > 0),
        );
      }}
      onSubmit={(e) => {
        if (none) e.preventDefault();
      }}
    >
      <input type="hidden" name="obligations" value={selected.join(",")} />
      {children}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#5C5456]">
        <button
          type="submit"
          disabled={none}
          className="h-11 rounded-md bg-[#C1121F] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50 md:h-9"
        >
          {labels.generate}
        </button>
        <span aria-live="polite">
          {none ? labels.selectAtLeastOne : labels.selected.replace("{n}", String(selected.length))}
          {" · "}
          {labels.opensInTab}
        </span>
      </div>
    </form>
  );
}
