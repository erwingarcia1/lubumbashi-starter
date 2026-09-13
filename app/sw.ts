import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

/**
 * Agent PWA service worker (M8). The app shell and static chunks are precached at build time;
 * agent pages and read-only API calls are network-first with the last good copy as fallback.
 * Payments and the login are network-only: nothing money-related is ever served from a cache
 * (CLAUDE.md invariant 3).
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.pathname.startsWith("/api/v1/payments") ||
        url.pathname.startsWith("/api/v1/agent/") ||
        url.pathname.startsWith("/agent/encaisser") ||
        url.pathname === "/agent/login",
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ request, url }) =>
        request.mode === "navigate" && url.pathname.startsWith("/agent"),
      handler: new NetworkFirst({ cacheName: "agent-pages", networkTimeoutSeconds: 8 }),
    },
    {
      matcher: ({ request, url }) =>
        request.method === "GET" && url.pathname.startsWith("/api/v1/"),
      handler: new NetworkFirst({ cacheName: "agent-api", networkTimeoutSeconds: 8 }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/agent/hors-ligne",
        matcher: ({ request }) =>
          request.destination === "document" && new URL(request.url).pathname.startsWith("/agent"),
      },
    ],
  },
});

serwist.addEventListeners();
