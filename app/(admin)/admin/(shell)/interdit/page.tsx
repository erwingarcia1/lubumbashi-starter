import { t } from "@/lib/i18n";

export default function ForbiddenPage() {
  return (
    <div>
      <h2 className="text-lg font-bold">{t.admin.forbidden.title}</h2>
      <p className="text-[12.5px] text-[#5C5456]">{t.admin.forbidden.body}</p>
    </div>
  );
}
