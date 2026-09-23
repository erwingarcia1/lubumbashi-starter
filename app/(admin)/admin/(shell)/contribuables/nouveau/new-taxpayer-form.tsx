"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useActionState, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CITY_CENTER, COMMUNE_CENTERS } from "@/lib/admin/map-center";
import type { RegistrationCategory } from "@/lib/admin/register";
import { t } from "@/lib/i18n";

import type { CreateTaxpayerState } from "./actions";

interface Commune {
  code: string;
  name: string;
  quartiers: Array<{ code: string; name: string }>;
}
type Point = { lat: number; lng: number };

const R = t.agent.register;
const C = t.admin.taxpayers.create;

/** The same map picker as the agent app (French, bounded to Lubumbashi); Leaflet loads in the browser only. */
const PositionPicker = dynamic(
  () =>
    import("@/app/(agent)/agent/(shell)/recenser/position-picker").then((m) => m.PositionPicker),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-64 place-items-center rounded-lg bg-[#E8EFE9] text-[12.5px] text-[#4E5E52]">
        {t.common.loading}
      </div>
    ),
  },
);

const field = "h-11 text-base md:h-9 md:text-[13px]";
const select =
  "h-11 w-full min-w-0 rounded-md border border-[#D5CFCF] bg-white px-2 text-base md:h-9 md:text-[13px]";
const section = "text-[13px] font-bold tracking-wide text-[#5C5456] uppercase";

/**
 * Controlled fields: React resets an uncontrolled form once the action returns, and a refused
 * submission must keep what the clerk typed.
 */
export function NewTaxpayerForm({
  action,
  clientUuid,
  communes,
  categories,
  defaultCommune,
  maptilerKey,
}: {
  action: (state: CreateTaxpayerState, formData: FormData) => Promise<CreateTaxpayerState>;
  clientUuid: string;
  communes: Commune[];
  categories: RegistrationCategory[];
  defaultCommune: string;
  maptilerKey: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" });
  const [kind, setKind] = useState<"person" | "company">("person");
  const [fullName, setFullName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("+243");
  const [idNumber, setIdNumber] = useState("");
  const startCommune =
    communes.find((c) => c.code === defaultCommune && c.quartiers.length > 0)?.code ??
    communes.find((c) => c.quartiers.length > 0)?.code ??
    defaultCommune;
  const [commune, setCommune] = useState(startCommune);
  const [quartier, setQuartier] = useState(
    communes.find((c) => c.code === startCommune)?.quartiers[0]?.code ?? "",
  );
  const [address, setAddress] = useState("");
  const [entityKind, setEntityKind] = useState<"property" | "business" | "activity">("property");
  const [category, setCategory] = useState(categories[0]?.code ?? "");
  const [entityName, setEntityName] = useState("");
  const [taxBase, setTaxBase] = useState("");
  const [point, setPoint] = useState<Point | null>(null);
  const [picking, setPicking] = useState(true);

  const selectedCommune = communes.find((c) => c.code === commune);
  const noQuartier = (selectedCommune?.quartiers.length ?? 0) === 0;
  const needsTaxBase = categories.find((c) => c.code === category)?.needsTaxBase ?? false;
  const centre = COMMUNE_CENTERS[commune] ?? CITY_CENTER;

  function changeCommune(code: string) {
    setCommune(code);
    setQuartier(communes.find((c) => c.code === code)?.quartiers[0]?.code ?? "");
    // The point belongs to the commune: a new commune means a new point.
    setPoint(null);
    setPicking(true);
  }

  return (
    <form
      action={formAction}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-[#E3DEDE] bg-white p-3.5"
    >
      <input type="hidden" name="clientUuid" value={clientUuid} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="lat" value={point ? String(point.lat) : ""} />
      <input type="hidden" name="lng" value={point ? String(point.lng) : ""} />
      <p className="text-[12.5px] text-[#5C5456]">{C.hint}</p>
      {state.status === "error" ? (
        <div
          role="alert"
          className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px] break-words"
        >
          {state.code === "duplicate_phone" && state.existingTaxpayerNo ? (
            <>
              {C.duplicatePhone} <b className="font-mono">{state.existingTaxpayerNo}</b> ·{" "}
              <Link
                href={`/admin/contribuables/${state.existingTaxpayerNo}` as never}
                className="text-[#C1121F] underline"
              >
                {C.openExisting}
              </Link>
            </>
          ) : (
            (t.admin.errors[state.code] ?? t.admin.errors.invalid_input)
          )}
        </div>
      ) : null}

      <p className={section}>{C.identity}</p>
      <div
        role="group"
        aria-label={C.kind}
        className="inline-flex self-start overflow-hidden rounded-md border border-[#D5CFCF] text-[12.5px]"
      >
        {(["person", "company"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`min-h-11 px-3 md:min-h-9 ${kind === k ? "bg-[#C1121F] text-white" : "bg-white"}`}
          >
            {k === "person" ? R.person : R.company}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="fullName">{kind === "person" ? R.fullName : R.companyName}</Label>
          <Input
            id="fullName"
            name="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={3}
            maxLength={120}
            className={field}
          />
        </div>
        {kind === "company" ? (
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="contactName">{R.contactName}</Label>
            <Input
              id="contactName"
              name="contactName"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              maxLength={120}
              className={field}
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="phone">{R.phone}</Label>
          <Input
            id="phone"
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\s/g, ""))}
            inputMode="tel"
            pattern="^\+[1-9][0-9]{6,14}$"
            required
            className={`${field} font-mono`}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="idNumber">{R.idDoc}</Label>
          <Input
            id="idNumber"
            name="idNumber"
            value={idNumber}
            onChange={(e) => setIdNumber(e.target.value)}
            placeholder={R.idDocPlaceholder}
            maxLength={60}
            className={field}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="communeCode">{R.commune}</Label>
          <select
            id="communeCode"
            name="communeCode"
            value={commune}
            onChange={(e) => changeCommune(e.target.value)}
            className={select}
          >
            {communes.map((c) => (
              <option key={c.code} value={c.code} disabled={c.quartiers.length === 0}>
                {c.quartiers.length === 0 ? `${c.name} · ${R.noQuartier}` : c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="quartierCode">{R.quartier}</Label>
          <select
            id="quartierCode"
            name="quartierCode"
            value={quartier}
            onChange={(e) => setQuartier(e.target.value)}
            required
            className={select}
          >
            {(selectedCommune?.quartiers ?? []).map((q) => (
              <option key={q.code} value={q.code}>
                {q.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1 md:col-span-2">
          <Label htmlFor="address">{R.address}</Label>
          <Input
            id="address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            minLength={3}
            maxLength={200}
            className={field}
          />
        </div>
      </div>
      {noQuartier ? (
        <p
          role="alert"
          className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]"
        >
          {R.noQuartierWarn}
        </p>
      ) : null}

      <p className={section}>{C.entity}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="entityKind">{R.entityKind}</Label>
          <select
            id="entityKind"
            name="entityKind"
            value={entityKind}
            onChange={(e) => setEntityKind(e.target.value as typeof entityKind)}
            className={select}
          >
            {(["property", "business", "activity"] as const).map((k) => (
              <option key={k} value={k}>
                {R.kinds[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="categoryCode">{R.category}</Label>
          <select
            id="categoryCode"
            name="categoryCode"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className={select}
          >
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.labelFr}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="entityName">{R.entityName}</Label>
          <Input
            id="entityName"
            name="entityName"
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder={address}
            maxLength={120}
            className={field}
          />
          <p className="text-[12px] text-[#5C5456]">{C.entityNameHint}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="taxBaseFc">{C.taxBase}</Label>
          <Input
            id="taxBaseFc"
            name="taxBaseFc"
            value={taxBase}
            onChange={(e) => setTaxBase(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            pattern="[0-9]*"
            required={needsTaxBase}
            className={`${field} font-mono`}
          />
          <p className="text-[12px] text-[#5C5456]">
            {needsTaxBase ? C.taxBaseRequired : C.taxBaseOptional}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className={section}>{C.position}</p>
        {picking ? (
          <PositionPicker
            key={commune}
            center={[centre.lat, centre.lng]}
            maptilerKey={maptilerKey}
            onCancel={() => setPicking(false)}
            onUse={(p) => {
              setPoint(p);
              setPicking(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            {point ? (
              <>
                <span className="text-[#5C5456]">{C.positionPlaced}</span>
                <span className="font-mono">
                  {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                </span>
              </>
            ) : (
              <span className="text-[#5C5456]">{C.positionRequired}</span>
            )}
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="min-h-11 rounded-md border border-[#C1121F] bg-white px-3 text-[12.5px] font-semibold text-[#C1121F] md:min-h-9"
            >
              {point ? C.positionChange : R.gpsManualOpen}
            </button>
          </div>
        )}
        {picking && !point ? (
          <p className="text-[12.5px] text-[#5C5456]">{C.positionRequired}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || !point || noQuartier}
          className="h-11 w-full rounded-md bg-[#C1121F] px-4 text-[14px] font-semibold text-white disabled:opacity-60 md:h-9 md:w-auto md:text-[12.5px]"
        >
          {pending ? R.saving : R.submit}
        </button>
      </div>
    </form>
  );
}
