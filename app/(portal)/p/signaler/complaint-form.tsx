"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { t } from "@/lib/i18n";

const C = t.portal.complaint;

export function ComplaintForm({
  categories,
  phone,
}: {
  categories: Array<{ code: string; labelFr: string }>;
  phone: string;
}) {
  const router = useRouter();
  const [categoryCode, setCategoryCode] = useState(categories[0]?.code ?? "");
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState(phone);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/portal/complaints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryCode, description, phone: contact.replace(/\s+/g, "") }),
      });
      const json = (await res.json()) as { ok: boolean };
      if (!json.ok) {
        setError(t.agent.pay.errors.network);
        return;
      }
      setDone(true);
      setDescription("");
      router.refresh();
    } catch {
      setError(t.agent.pay.errors.network);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="border-ok rounded-lg border bg-[#F2FAF5] p-3.5">
        <div className="text-ok text-[15px] font-bold">{C.sent}</div>
        <p className="text-[12.5px] text-[#5C5456]">{t.portal.complaint.subtitle}</p>
        <button
          type="button"
          onClick={() => setDone(false)}
          className="mt-2 min-h-12 w-full rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-[15px] font-semibold"
        >
          {C.title}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[#5C5456]">
        {C.subject}
        <select
          value={categoryCode}
          onChange={(e) => setCategoryCode(e.target.value)}
          className="min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3 text-[15px] font-normal text-[#1B1B1F]"
        >
          {categories.map((c) => (
            <option key={c.code} value={c.code}>
              {c.labelFr}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[#5C5456]">
        {C.description}
        <textarea
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-[#D5CFCF] bg-white px-3 py-2 text-[15px] font-normal text-[#1B1B1F]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[#5C5456]">
        {C.phone}
        <input
          type="tel"
          required
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          className="min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3 font-mono text-[15px] font-normal text-[#1B1B1F]"
        />
      </label>
      {error ? (
        <div className="border-bad bg-bad-soft text-bad rounded border-l-4 px-3 py-2 text-[12.5px]">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
      >
        {busy ? t.portal.pay.sending : C.send}
      </button>
    </form>
  );
}
