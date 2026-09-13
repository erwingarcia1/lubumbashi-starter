import Link from "next/link";

import { t } from "@/lib/i18n";
import { demoPortalToken, isDemoEnvironment } from "@/lib/portal/demo";

/** Launcher for the three surfaces; the portal has no login page, only links sent by SMS. */
export default function HomePage() {
  const H = t.home;
  const demo = isDemoEnvironment();
  const cards = [
    { name: t.surfaces.agent, body: H.agentBody, cta: H.agentCta, href: "/agent/login" as const },
    { name: t.surfaces.admin, body: H.adminBody, cta: H.adminCta, href: "/admin/login" as const },
  ];
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="bg-primary text-primary-foreground rounded-xl px-6 py-5">
        <h1 className="text-2xl font-bold tracking-tight">{t.app.title}</h1>
        <p className="mt-1 text-sm opacity-90">{t.app.tagline}</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.name}
            className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
          >
            <p className="font-semibold">{c.name}</p>
            <p className="text-muted-foreground flex-1 text-sm">{c.body}</p>
            <Link
              href={c.href}
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold"
            >
              {c.cta}
            </Link>
          </div>
        ))}
        <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
          <p className="font-semibold">{t.surfaces.portal}</p>
          <p className="text-muted-foreground flex-1 text-sm">{H.portalBody}</p>
          {demo ? (
            <Link
              href={`/t/${demoPortalToken("LUB-KAM-00000125")}` as never}
              className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center rounded-md px-4 text-center text-sm font-semibold"
            >
              {H.portalDemo}
            </Link>
          ) : null}
          <Link
            href="/q/LUB-KAM-00000125"
            className="border-border inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-semibold"
          >
            {t.portal.sticker.request}
          </Link>
        </div>
      </section>
      {demo ? <p className="text-muted-foreground text-xs">{H.demoAccounts}</p> : null}
    </main>
  );
}
