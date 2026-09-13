import { Suspense } from "react";

import { t } from "@/lib/i18n";

import { AgentHeader } from "../_components/header";
import { LoginForm } from "./login-form";

export default function AgentLoginPage() {
  return (
    <>
      <AgentHeader title={t.agent.appName} subtitle={t.agent.appSubtitle} />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </>
  );
}
