import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";

import { signInAction } from "../_actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[#C1121F] text-sm font-bold text-white">
          L
        </div>
        <div className="min-w-0">
          <h1 className="text-base leading-tight font-bold">{t.admin.login.title}</h1>
          <p className="text-[12px] text-[#5C5456]">{t.admin.login.subtitle}</p>
        </div>
      </div>
      <form
        action={signInAction}
        className="flex flex-col gap-3 rounded-lg border border-[#E3DEDE] bg-white p-4"
      >
        <input type="hidden" name="next" value={next ?? ""} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="email">{t.admin.login.email}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className="h-11 md:h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="password">{t.admin.login.password}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-11 md:h-8"
          />
        </div>
        {error ? (
          <p className="text-bad text-[12.5px]">
            {error === "rate" ? t.admin.login.rateLimited : t.admin.login.error}
          </p>
        ) : null}
        <Button type="submit" className="h-11 md:h-8">
          {t.admin.login.submit}
        </Button>
        <p className="text-[11.5px] text-[#5C5456]">{t.admin.login.noAccount}</p>
      </form>
    </div>
  );
}
