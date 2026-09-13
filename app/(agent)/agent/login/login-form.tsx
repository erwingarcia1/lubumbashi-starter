"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

const DEVICE_KEY = "lub.agent.device";

interface StoredDevice {
  code: string;
  secret: string;
  label: string;
}

function readDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    return raw ? (JSON.parse(raw) as StoredDevice) : null;
  } catch {
    return null;
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const m = /\(([^)]+)\)/.exec(ua);
  const inner = m?.[1] ?? "";
  const android = /Android[^;]*;\s*([^;)]+)/.exec(inner)?.[1]?.trim();
  return android ?? (inner.split(";")[0] ?? "Navigateur").trim();
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const expired = params.get("expired") === "1";
  const [device, setDevice] = useState<StoredDevice | null>(null);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Browser-only state read after hydration (localStorage, navigator.onLine).
    const tid = window.setTimeout(() => {
      setDevice(readDevice());
      setOnline(navigator.onLine);
    }, 0);
    // A signed cookie whose device was revoked: drop it so the proxy stops trusting it.
    if (expired) void fetch("/api/v1/agent/logout", { method: "POST" });
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.clearTimeout(tid);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [expired]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const label = device?.label ?? deviceLabel();
    try {
      const res = await fetch("/api/v1/agent/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matricule: String(form.get("matricule") ?? "")
            .trim()
            .toUpperCase(),
          pin: String(form.get("pin") ?? ""),
          device: { code: device?.code, secret: device?.secret, label },
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { device: { code: string; secret?: string } };
        error?: { code: string };
      };
      if (!json.ok || !json.data) {
        const code = json.error?.code as keyof typeof t.agent.login.errors | undefined;
        setError((code && t.agent.login.errors[code]) ?? t.agent.login.errors.invalid_credentials);
        return;
      }
      if (json.data.device.secret) {
        localStorage.setItem(
          DEVICE_KEY,
          JSON.stringify({ code: json.data.device.code, secret: json.data.device.secret, label }),
        );
      }
      router.push("/agent");
      router.refresh();
    } catch {
      setError(t.agent.login.errors.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col justify-center gap-3.5 px-4 py-4">
      <div className="mb-1 text-center">
        <div className="text-[22px] font-bold">{t.agent.login.hello}</div>
        <div className="text-[12.5px] text-[#5C5456]">{t.agent.login.subtitle}</div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="matricule">{t.agent.login.matricule}</Label>
        <Input
          id="matricule"
          name="matricule"
          placeholder="AG-KAM-007"
          autoCapitalize="characters"
          autoComplete="username"
          required
          className="h-12 text-base"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pin">{t.agent.login.pin}</Label>
        <Input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="current-password"
          required
          className="h-12 text-base tracking-[0.3em]"
        />
      </div>
      <div className="rounded-lg border border-[#E3DEDE] bg-white px-3.5 py-2 text-[12px]">
        <div className="flex justify-between border-b border-[#EFEAEA] py-1.5">
          <span>{t.agent.login.device}</span>
          <b className="font-mono">
            {device ? `${device.label} · ${device.code}` : t.agent.login.newDevice}
          </b>
        </div>
        <div className="flex justify-between py-1.5">
          <span>{t.agent.login.network}</span>
          <b className={online ? "text-ok" : "text-bad"}>
            {online ? t.agent.login.online : t.agent.login.offline}
          </b>
        </div>
      </div>
      {error ? (
        <p className="border-bad bg-bad-soft rounded border-l-4 px-3 py-2 text-[12.5px]">{error}</p>
      ) : null}
      <Button type="submit" disabled={busy || !online} className="h-12 text-[15px]">
        {t.agent.login.submit}
      </Button>
      <p className="text-center text-[12.5px] text-[#5C5456]">{t.agent.login.forgot}</p>
    </form>
  );
}
