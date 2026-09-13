"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows progress while its server action runs (the remote database is far). */
export function PendingButton({
  label,
  pendingLabel,
  className,
}: {
  label: string;
  pendingLabel: string;
  className: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel : label}
    </button>
  );
}
