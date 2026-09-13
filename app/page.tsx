import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function HomePage() {
  const surfaces = [t.surfaces.agent, t.surfaces.admin, t.surfaces.portal];
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="bg-primary text-primary-foreground rounded-xl px-6 py-5">
        <h1 className="text-2xl font-bold tracking-tight">{t.app.title}</h1>
        <p className="mt-1 text-sm opacity-90">{t.app.tagline}</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        {surfaces.map((name) => (
          <div key={name} className="border-border bg-card rounded-lg border p-4">
            <p className="font-semibold">{name}</p>
            <p className="text-muted-foreground text-sm">{t.common.comingSoon}</p>
          </div>
        ))}
      </section>
      <div>
        <Button>{t.common.start}</Button>
      </div>
    </main>
  );
}
