"use client";

import { useActionState } from "react";

import { t } from "@/lib/i18n";
import { ADMIN_ROLES } from "@/lib/identity/roles";

import type { CreateUserState } from "../../_actions";

const S = t.admin.settings;

/** The temporary password is shown once, here, and nowhere else. */
export function NewUserForm({
  action,
}: {
  action: (state: CreateUserState, formData: FormData) => Promise<CreateUserState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  return (
    <form action={formAction} className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-3">
      <p className="text-[13px] font-bold tracking-wide text-[#5C5456] uppercase">{S.newUser}</p>
      <p className="mt-1 text-[12px] text-[#5C5456]">{S.newUserHint}</p>
      {state.status === "created" ? (
        <div className="border-ok mt-2 rounded border-l-4 bg-[#F2FAF5] px-3 py-2 text-[12.5px] break-words">
          <b>{S.created}</b> {state.email}
          <div className="mt-1">
            {S.temporaryPassword}{" "}
            <code className="font-mono text-[13px] break-all">{state.temporaryPassword}</code>
          </div>
          <div className="text-[#5C5456]">{S.passwordOnce}</div>
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="border-bad bg-bad-soft text-bad mt-2 rounded border-l-4 px-3 py-2 text-[12.5px] break-words">
          {t.admin.errors[state.code] ?? t.admin.errors.invalid_input}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
        <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
          {S.email}
          <input
            name="email"
            type="email"
            required
            className="h-11 w-full rounded-md border border-[#D5CFCF] px-2 text-[16px] text-[#1B1B1F] md:h-9 md:w-64 md:text-[12.5px]"
          />
        </label>
        <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
          {S.fullName}
          <input
            name="fullName"
            required
            minLength={3}
            className="h-11 w-full rounded-md border border-[#D5CFCF] px-2 text-[16px] text-[#1B1B1F] md:h-9 md:w-56 md:text-[12.5px]"
          />
        </label>
        <label className="flex w-full flex-col gap-0.5 text-[#5C5456] md:w-auto">
          {S.role}
          <select
            name="role"
            defaultValue="finances"
            className="h-11 w-full rounded-md border border-[#D5CFCF] bg-white px-2 text-[16px] text-[#1B1B1F] md:h-9 md:w-auto md:text-[12.5px]"
          >
            {ADMIN_ROLES.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="h-11 w-full rounded-md bg-[#C1121F] px-3 text-[14px] font-semibold text-white disabled:opacity-60 md:h-9 md:w-auto md:text-[12.5px]"
        >
          {pending ? S.creating : S.create}
        </button>
      </div>
    </form>
  );
}
