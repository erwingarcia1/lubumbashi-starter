import { t } from "@/lib/i18n";

const LABELS: Record<string, string> = {
  overview: t.admin.nav.overview,
  collections: t.admin.nav.collections,
  map: t.admin.nav.map,
  agents: t.admin.nav.agents,
  reconciliation: t.admin.nav.reconciliation,
  audit: t.admin.nav.audit,
  reports: t.admin.nav.reports,
};

export default async function ComingSoonPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return (
    <div>
      <h2 className="text-lg font-bold">{LABELS[section] ?? section}</h2>
      <p className="text-[12.5px] text-[#5C5456]">{t.common.comingSoon}</p>
    </div>
  );
}
