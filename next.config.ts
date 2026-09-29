import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment target is Docker Compose (docs/DECISIONS.md D23): self-contained standalone output.
  output: "standalone",
  typedRoutes: true,
  // Heavy server-only libraries stay outside the bundle (receipt PDFs).
  serverExternalPackages: ["@react-pdf/renderer"],
  // pdfkit loads its standard font metrics with a dynamic require that the standalone file
  // tracer cannot follow; without this the PDF routes fail in Docker with "Cannot find module
  // …/pdfkit/js/standard-fonts/Helvetica.cjs".
  outputFileTracingIncludes: {
    "/api/v1/receipts/[receiptNo]/pdf": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**"],
    "/api/v1/admin/reports/[code]": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**"],
    "/api/v1/admin/invoices/[invoiceNo]/pdf": [
      "./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**",
    ],
    "/api/v1/admin/invoices/pdf": ["./node_modules/.pnpm/pdfkit@*/node_modules/pdfkit/js/**"],
  },
};

/**
 * The agent PWA's service worker is built by Serwist, which needs webpack: `pnpm build` runs
 * `next build --webpack`. In development (Turbopack) the worker is not generated and the config
 * is left untouched, so `next dev` keeps its default bundler.
 */
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: false,
  additionalPrecacheEntries: [
    { url: "/agent/hors-ligne", revision: process.env.SW_REVISION ?? "1" },
  ],
  // The agent phone must not download the dashboard's or the portal's chunks (first load < 500 KB).
  exclude: [/\(admin\)/, /\(portal\)/, /\.map$/, /^build-manifest\.json$/],
});

export default process.env.NODE_ENV === "development" ? nextConfig : withSerwist(nextConfig);
