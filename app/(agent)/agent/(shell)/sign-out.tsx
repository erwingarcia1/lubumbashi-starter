"use client";

import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="min-h-12 text-[12.5px] text-[#5C5456] underline"
      onClick={async () => {
        await fetch("/api/v1/agent/logout", { method: "POST" });
        router.push("/agent/login");
        router.refresh();
      }}
    >
      {t.agent.home.signOut}
    </button>
  );
}
