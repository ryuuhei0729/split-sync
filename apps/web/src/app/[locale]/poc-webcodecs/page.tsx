import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supportedLocales } from "@swimhub-timer/i18n";
import { PocWebCodecsClient } from "./PocWebCodecsClient";

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

// Internal diagnostic page — never index it, and never link it from production nav
// (direct URL only). See `docs`/Sprint Contract for the WebCodecs export PoC.
export const metadata: Metadata = {
  title: "WebCodecs PoC",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

/**
 * Reviewer C3: this page calls `exportVideoWithStopwatchWebCodecs` directly, bypassing
 * auth/plan/guest-daily-limit checks entirely (see `useVideoExport.ts` for the real,
 * gated flow). noindex/robots only stop crawlers, not someone who knows the URL — so the
 * page itself must be unreachable in a real production deployment.
 *
 * Enabled automatically outside a production build (local `next dev`). To check it on a
 * real device against a preview/staging deployment (e.g. a real iPhone, per the Sprint
 * Contract), set `NEXT_PUBLIC_ENABLE_WEBCODECS_POC=1` in that deployment's environment
 * variables — never set it for the production environment.
 *
 * Operational note: `NEXT_PUBLIC_*` vars are inlined into the JS bundle at `next build`
 * time, not read at runtime — so setting/changing this var *after* a deployment already
 * exists has no effect; you must re-run `next build` (i.e. redeploy) for that environment
 * with the variable set for the flag to take effect. QA's local verification also found
 * cases where the enable path did not work under Next 16 Turbopack production builds, so
 * if you plan to rely on this flag for a preview/staging deployment, verify it end-to-end
 * through the actual deploy pipeline (`opennextjs-cloudflare`) beforehand rather than
 * assuming it will work.
 */
const isPocEnabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_WEBCODECS_POC === "1";

export default async function PocWebCodecsPage({ params }: { params: Promise<{ locale: string }> }) {
  await params;
  if (!isPocEnabled) {
    notFound();
  }
  return <PocWebCodecsClient />;
}
