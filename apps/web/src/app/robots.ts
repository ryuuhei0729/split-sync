import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Internal WebCodecs export PoC / real-device diagnostic page — not a production
        // route, direct-link only (see also the page's own `robots: { index: false }`).
        disallow: "/*/poc-webcodecs",
      },
    ],
    sitemap: "https://timer.swim-hub.app/sitemap.xml",
  };
}
