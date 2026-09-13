import type { AdminErrorCode } from "@/lib/admin/errors";
import { t } from "@/lib/i18n";

/** One-line feedback after a server action, driven by `?ok=` / `?error=` in the URL. */
export function Banner({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    const message = t.admin.errors[error as AdminErrorCode] ?? t.admin.errors.invalid_input;
    return (
      <div className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
        {message}
      </div>
    );
  }
  if (ok)
    return (
      <div className="border-ok bg-ok-soft rounded border-l-4 px-3 py-2 text-[12.5px]">{ok}</div>
    );
  return null;
}
