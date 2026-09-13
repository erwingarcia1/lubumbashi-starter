import { t } from "@/lib/i18n";

import { AgentHeader } from "../../_components/header";
import { Scanner } from "./scanner";

export default function ScannerPage() {
  return (
    <>
      <AgentHeader title={t.agent.scan.title} subtitle={t.agent.scan.subtitle} />
      <Scanner />
    </>
  );
}
