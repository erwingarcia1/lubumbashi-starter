"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { getAgentDb } from "@/lib/offline/db";
import { enqueue, syncOutbox } from "@/lib/offline/outbox";

const P = t.agent.profile;

/**
 * Phone and address edits go through the offline outbox (invariant 3 allows contact updates),
 * so the same form works with or without network: online it syncs at once.
 */
export function ContactForm({
  taxpayerNo,
  phone,
  address,
}: {
  taxpayerNo: string;
  phone: string;
  address: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nextPhone, setNextPhone] = useState(phone);
  const [nextAddress, setNextAddress] = useState(address);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const db = getAgentDb();
      await enqueue(db, {
        kind: "contact_update",
        clientUuid: crypto.randomUUID(),
        payload: { taxpayerNo, phone: nextPhone, address: nextAddress.trim() },
        label: `${taxpayerNo} · ${P.editContact}`,
      });
      if (navigator.onLine) {
        const r = await syncOutbox(db);
        setNotice(r.sent > 0 ? P.contactSaved : P.contactQueued);
        router.refresh();
      } else setNotice(P.contactQueued);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing)
    return (
      <div className="flex flex-col gap-2">
        {notice ? <p className="text-ok text-[12.5px] font-semibold">{notice}</p> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-[14px] font-semibold"
        >
          {P.editContact}
        </button>
      </div>
    );

  return (
    <form onSubmit={save} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="contactPhone">{P.phone}</Label>
        <Input
          id="contactPhone"
          value={nextPhone}
          onChange={(e) => setNextPhone(e.target.value.replace(/\s/g, ""))}
          inputMode="tel"
          pattern="^\+[1-9][0-9]{6,14}$"
          required
          className="h-12 font-mono text-base"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="contactAddress">{P.address}</Label>
        <Input
          id="contactAddress"
          value={nextAddress}
          onChange={(e) => setNextAddress(e.target.value)}
          required
          minLength={3}
          className="h-12 text-base"
        />
      </div>
      <div className="flex gap-2.5">
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing(false)}
          className="h-12 flex-1 text-[15px]"
        >
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={busy} className="h-12 flex-[2] text-[15px]">
          {t.common.save}
        </Button>
      </div>
    </form>
  );
}
