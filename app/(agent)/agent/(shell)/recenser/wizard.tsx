"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { compressImage } from "@/lib/census/compress-image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateFr, formatFC } from "@/lib/i18n/format";
import { t } from "@/lib/i18n";

import { AgentHeader } from "../../_components/header";

interface Commune {
  code: string;
  name: string;
  quartiers: Array<{ code: string; name: string }>;
}
interface Category {
  code: string;
  label: string;
}
interface Duplicate {
  taxpayerNo: string;
  fullName: string;
  reason: "same_phone" | "similar_name_nearby";
  distanceM: number | null;
}
interface Preview {
  ruleCode: string;
  periodStart: string;
  dueDate: string;
  amountFc: number;
}
interface Result {
  taxpayerNo: string;
  entityId: string;
  obligations: Array<{ ruleCode: string; periodStart: string; dueDate: string; amountFc: number }>;
}

const R = t.agent.register;

async function api<T>(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; data?: T; error?: { code: string } };
    return json.ok && json.data !== undefined
      ? { ok: true, data: json.data }
      : { ok: false, code: json.error?.code ?? "invalid_input" };
  } catch {
    return { ok: false, code: "network" };
  }
}

export function CensusWizard({
  communes,
  categories,
  defaultCommune,
  appUrl,
}: {
  communes: Commune[];
  categories: Category[];
  defaultCommune: string;
  appUrl: string;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<"person" | "company">("person");
  const [fullName, setFullName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("+243");
  const [idNumber, setIdNumber] = useState("");
  const [commune, setCommune] = useState(defaultCommune);
  const [quartier, setQuartier] = useState(
    communes.find((c) => c.code === defaultCommune)?.quartiers[0]?.code ?? "",
  );
  const [address, setAddress] = useState("");
  const [entityKind, setEntityKind] = useState<"property" | "business" | "activity">("property");
  const [category, setCategory] = useState(categories[0]?.code ?? "menage");
  const [entityName, setEntityName] = useState("");
  const [gps, setGps] = useState<{ lng: number; lat: number; accuracyM: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [preview, setPreview] = useState<Preview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [photos, setPhotos] = useState<{ person?: Blob; id_card?: Blob; facade?: Blob }>({});
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);
  const dupTimer = useRef<number | null>(null);

  // GPS from the start so step 1 can already warn about a neighbour with a similar name.
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      const tid = window.setTimeout(() => setGpsError(R.gpsDenied), 0);
      return () => window.clearTimeout(tid);
    }
    const id = navigator.geolocation.watchPosition(
      (pos) =>
        setGps({
          lng: pos.coords.longitude,
          lat: pos.coords.latitude,
          accuracyM: Math.round(pos.coords.accuracy),
        }),
      () => setGpsError(R.gpsDenied),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Duplicate check: same phone, or similar name within 30 m (debounced).
  useEffect(() => {
    if (dupTimer.current) window.clearTimeout(dupTimer.current);
    const phoneOk = /^\+[1-9]\d{6,14}$/.test(phone);
    const nameOk = fullName.trim().length >= 3;
    dupTimer.current = window.setTimeout(async () => {
      if (!phoneOk && !(nameOk && gps)) {
        setDuplicates([]);
        return;
      }
      const r = await api<Duplicate[]>("/api/v1/census/duplicates", {
        phone: phoneOk ? phone : undefined,
        fullName: nameOk ? fullName.trim() : undefined,
        gps: gps ? { lng: gps.lng, lat: gps.lat } : undefined,
      });
      if (r.ok) setDuplicates(r.data);
    }, 500);
  }, [phone, fullName, gps]);

  useEffect(() => {
    if (step !== 2) return;
    void api<Preview[]>("/api/v1/census/preview", { categoryCode: category }).then((r) =>
      setPreview(r.ok ? r.data : []),
    );
  }, [step, category]);

  useEffect(() => {
    if (!result) return;
    void QRCode.toDataURL(`${appUrl.replace(/\/$/, "")}/q/${result.taxpayerNo}`, {
      margin: 1,
      width: 220,
    }).then(setQr);
  }, [result, appUrl]);

  const selectedCommune = communes.find((c) => c.code === commune);
  const firstDue = preview[0];

  async function submit() {
    if (!gps) {
      setError(R.gpsDenied);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await api<Result>("/api/v1/census", {
      clientUuid,
      taxpayer: {
        kind,
        fullName: fullName.trim(),
        contactName: kind === "company" && contactName ? contactName.trim() : undefined,
        phone,
        idType: idNumber ? "carte_electeur" : undefined,
        idNumber: idNumber || undefined,
        communeCode: commune,
        quartierCode: quartier,
        address: address.trim(),
      },
      entity: {
        kind: entityKind,
        categoryCode: category,
        name: entityName.trim() || `${address.trim()}`,
        gps,
      },
      capturedAt: new Date().toISOString(),
    });
    setBusy(false);
    if (!r.ok) {
      const code = r.code as keyof typeof R.errors;
      setError(R.errors[code] ?? R.errors.invalid_input);
      return;
    }
    setResult(r.data);
    setStep(3);
    void uploadPhotos(r.data.entityId);
  }

  /** Photos go straight to the private bucket through one-shot signed URLs; failures never block the record. */
  async function uploadPhotos(entityId: string) {
    const entries = Object.entries(photos).filter(([, blob]) => blob) as Array<
      [keyof typeof photos, Blob]
    >;
    if (entries.length === 0) return;
    let sent = 0;
    for (const [kind, blob] of entries) {
      const url = await api<{ storagePath: string; signedUrl: string }>(
        "/api/v1/census/photos/upload-url",
        { entityId, kind },
      );
      if (!url.ok) continue;
      try {
        const put = await fetch(url.data.signedUrl, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: blob,
        });
        if (!put.ok) continue;
        const reg = await api("/api/v1/census/photos", {
          entityId,
          kind,
          storagePath: url.data.storagePath,
          bytes: blob.size,
        });
        if (reg.ok) sent += 1;
      } catch {
        /* offline or storage down: the record stands, photos can be re-sent later (M8) */
      }
    }
    setPhotoStatus(`${sent}/${entries.length}`);
  }

  async function onPickPhoto(kind: keyof typeof photos, file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressImage(file);
      setPhotos((p) => ({ ...p, [kind]: blob }));
    } catch {
      setPhotos((p) => ({ ...p, [kind]: file }));
    }
  }

  return (
    <>
      <AgentHeader
        title={R.title}
        subtitle={`${R.step} ${step} ${R.of} 3 · ${step === 1 ? R.step1 : step === 2 ? R.step2 : R.step3}`}
      />
      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        {step === 1 ? (
          <form
            className="flex flex-1 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(2);
            }}
          >
            <div className="inline-flex self-start overflow-hidden rounded-md border border-[#D5CFCF] text-[12px]">
              {(["person", "company"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`min-h-9 px-3 ${kind === k ? "bg-[#C1121F] text-white" : "bg-white"}`}
                >
                  {k === "person" ? R.person : R.company}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="fullName">{kind === "person" ? R.fullName : R.companyName}</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={3}
                className="h-12 text-base"
              />
            </div>
            {kind === "company" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="contactName">{R.contactName}</Label>
                <Input
                  id="contactName"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="h-12 text-base"
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor="phone">{R.phone}</Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\s/g, ""))}
                inputMode="tel"
                pattern="^\+[1-9][0-9]{6,14}$"
                required
                className="h-12 font-mono text-base"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="idNumber">{R.idDoc}</Label>
              <Input
                id="idNumber"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder={R.idDocPlaceholder}
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{R.photos}</Label>
              <div className="flex gap-2.5">
                {(["person", "id_card"] as const).map((kind) => (
                  <label
                    key={kind}
                    className={`flex min-h-12 flex-1 cursor-pointer flex-col items-center justify-center rounded-md border px-2 py-3 text-center text-[13px] ${photos[kind] ? "border-ok bg-ok-soft" : "border-[#D5CFCF] bg-white"}`}
                  >
                    <span aria-hidden="true">{kind === "person" ? "📷" : "🪪"}</span>
                    {kind === "person" ? R.photoPerson : R.photoId}
                    {photos[kind] ? " ✓" : ""}
                    <input
                      type="file"
                      accept="image/*"
                      capture={kind === "person" ? "user" : "environment"}
                      className="sr-only"
                      onChange={(e) => void onPickPhoto(kind, e.target.files?.[0])}
                    />
                  </label>
                ))}
              </div>
              <p className="text-[12px] text-[#5C5456]">{R.photosNote}</p>
            </div>
            <div className="flex gap-2.5">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="commune">{R.commune}</Label>
                <select
                  id="commune"
                  value={commune}
                  onChange={(e) => {
                    setCommune(e.target.value);
                    setQuartier(
                      communes.find((c) => c.code === e.target.value)?.quartiers[0]?.code ?? "",
                    );
                  }}
                  className="h-12 rounded-md border border-[#D5CFCF] bg-white px-2 text-base"
                >
                  {communes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="quartier">{R.quartier}</Label>
                <select
                  id="quartier"
                  value={quartier}
                  onChange={(e) => setQuartier(e.target.value)}
                  required
                  className="h-12 rounded-md border border-[#D5CFCF] bg-white px-2 text-base"
                >
                  {(selectedCommune?.quartiers ?? []).map((q) => (
                    <option key={q.code} value={q.code}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="address">{R.address}</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                minLength={3}
                className="h-12 text-base"
              />
            </div>
            {duplicates.length > 0 ? (
              <div className="border-warn bg-warn-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
                {R.duplicate} <b>{duplicates[0]!.fullName}</b>{" "}
                {duplicates[0]!.reason === "same_phone"
                  ? `(${R.duplicateSamePhone})`
                  : `${R.duplicateAt} ${Math.round(duplicates[0]!.distanceM ?? 0)} m`}{" "}
                (<span className="font-mono">{duplicates[0]!.taxpayerNo}</span>).{" "}
                <Link
                  href={`/agent/contribuables/${duplicates[0]!.taxpayerNo}` as never}
                  className="text-[#C1121F] underline"
                >
                  Voir
                </Link>
              </div>
            ) : null}
            <div className="mt-auto">
              <Button type="submit" className="h-12 w-full text-[15px]">
                {R.continue}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <form
            className="flex flex-1 flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="entityKind">{R.entityKind}</Label>
              <select
                id="entityKind"
                value={entityKind}
                onChange={(e) => setEntityKind(e.target.value as typeof entityKind)}
                className="h-12 rounded-md border border-[#D5CFCF] bg-white px-2 text-base"
              >
                {(["property", "business", "activity"] as const).map((k) => (
                  <option key={k} value={k}>
                    {R.kinds[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="category">{R.category}</Label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-12 rounded-md border border-[#D5CFCF] bg-white px-2 text-base"
              >
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="entityName">{R.entityName}</Label>
              <Input
                id="entityName"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder={address}
                className="h-12 text-base"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>{R.photoFacade}</Label>
              <label
                className={`flex min-h-12 cursor-pointer items-center justify-center rounded-md border px-2 py-3 text-[13px] ${photos.facade ? "border-ok bg-ok-soft" : "border-[#D5CFCF] bg-white"}`}
              >
                📷 {R.photoFacade}
                {photos.facade ? " ✓" : ""}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => void onPickPhoto("facade", e.target.files?.[0])}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <Label>{R.gps}</Label>
              <div className="relative h-28 overflow-hidden rounded-lg bg-[#E8EFE9]">
                <div className="absolute top-[55%] right-0 left-0 h-1.5 bg-white" />
                <div className="absolute top-0 bottom-0 left-[40%] w-1.5 bg-white" />
                {gps ? (
                  <div className="absolute top-[44%] left-[48%] h-3.5 w-3.5 rounded-full border-2 border-white bg-[#C1121F] shadow" />
                ) : null}
              </div>
              <p className="font-mono text-[12.5px] text-[#5C5456]">
                {gps
                  ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)} · ${R.gpsAccuracy} ${gps.accuracyM} m ${gps.accuracyM <= 15 ? "✓" : ""}`
                  : (gpsError ?? R.gpsWaiting)}
              </p>
            </div>
            <div className="rounded-lg border-l-4 border-[#C1121F] bg-white px-3.5 py-2.5 text-[12.5px]">
              {[
                [R.obligation, firstDue ? firstDue.ruleCode : t.common.none],
                [R.amount, firstDue ? formatFC(firstDue.amountFc) : t.common.none],
                [R.firstDue, firstDue ? formatDateFr(firstDue.dueDate) : t.common.none],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between border-b border-[#EFEAEA] py-1.5 last:border-0"
                >
                  <span>{k}</span>
                  <b className="font-mono">{v}</b>
                </div>
              ))}
            </div>
            {error ? (
              <p className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">
                {error}
              </p>
            ) : null}
            <div className="mt-auto flex gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                className="h-12 flex-1 text-[15px]"
              >
                {R.back}
              </Button>
              <Button type="submit" disabled={busy || !gps} className="h-12 flex-[2] text-[15px]">
                {busy ? R.saving : R.submit}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 && result ? (
          <div className="flex flex-1 flex-col gap-3">
            <div className="text-center">
              <div className="bg-ok mx-auto my-2 grid h-16 w-16 place-items-center rounded-full text-[34px] text-white">
                ✓
              </div>
              <div className="text-[16px] font-bold">{R.registered}</div>
              <div className="mt-1 font-mono text-[17px] font-medium">{result.taxpayerNo}</div>
            </div>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL generated on the phone
              <img
                src={qr}
                alt={result.taxpayerNo}
                className="mx-auto h-[150px] w-[150px] rounded-md border border-[#E3DEDE] bg-white p-1.5"
              />
            ) : null}
            <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2.5 text-[12.5px]">
              {[
                [R.fullName, fullName],
                [R.entityName, entityName || address],
                [
                  R.firstDue,
                  result.obligations[0]
                    ? `${formatFC(result.obligations[0].amountFc)} · ${formatDateFr(result.obligations[0].dueDate)}`
                    : t.common.none,
                ],
                [R.smsQueued, phone.replace(/^(\+\d{5})\d+(\d{4})$/, "$1 ••• $2")],
                [R.photosSent, photoStatus ?? (Object.keys(photos).length ? "…" : t.common.none)],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between border-b border-[#EFEAEA] py-1.5 last:border-0"
                >
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <p className="text-center text-[12.5px] text-[#5C5456]">{R.sticker}</p>
            <Link
              href={`/agent/encaisser/${result.taxpayerNo}` as never}
              className="block min-h-12 rounded-lg bg-[#C1121F] px-3.5 py-3 text-center text-[15px] font-semibold text-white"
            >
              {R.payNow}
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-12 rounded-lg border border-[#D5CFCF] bg-white px-3.5 py-3 text-[15px] font-semibold"
            >
              {R.printLater}
            </button>
            <Link
              href="/agent/recenser"
              className="text-center text-[12.5px] text-[#5C5456] underline"
            >
              {R.newOne}
            </Link>
          </div>
        ) : null}
      </div>
    </>
  );
}
