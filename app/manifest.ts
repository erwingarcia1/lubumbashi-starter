import type { MetadataRoute } from "next";

import { t } from "@/lib/i18n";

/** Installable agent PWA; the Serwist service worker (app/sw.ts) caches the shell from M8. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${t.agent.appName} · ${t.admin.brand}`,
    short_name: t.agent.appName,
    description: t.agent.appSubtitle,
    lang: "fr",
    start_url: "/agent",
    scope: "/agent",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F6F5F2",
    theme_color: "#C1121F",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
