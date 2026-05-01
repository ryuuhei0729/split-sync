import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/components/I18nProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { KeyboardScrollProvider } from "@/components/keyboard/KeyboardScrollProvider";
import { supportedLocales, i18nResources, type SupportedLocale } from "@swimhub-timer/i18n";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (supportedLocales as readonly string[]).includes(locale);
}

const siteUrl = "https://timer.swim-hub.app";

export function generateStaticParams() {
  return supportedLocales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  const t = i18nResources[locale].translation;

  return {
    title: t.meta.title,
    description: t.meta.description,
    metadataBase: new URL(siteUrl),
    alternates: {
      canonical: `/${locale}`,
      languages: {
        ja: "/ja",
        en: "/en",
      },
    },
    keywords: [...t.meta.keywords],
    openGraph: {
      title: t.meta.title,
      description: t.meta.description,
      url: siteUrl,
      siteName: "SwimHub Timer",
      locale: t.meta.ogLocale,
      type: "website",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: "SwimHub Timer",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.title,
      description: t.meta.description,
      images: ["/og-image.png"],
    },
    icons: {
      icon: "/icon.png",
      apple: "/apple-touch-icon.png",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
      },
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#EFF6FF",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();

  const t = i18nResources[locale].translation;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "SwimHub Timer",
    url: siteUrl,
    description: t.meta.description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "JPY",
    },
    inLanguage: locale,
  };

  return (
    <html lang={locale} className="h-full">
      <body className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
        <I18nProvider locale={locale}>
          <AuthProvider>
            <KeyboardScrollProvider>
              <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
              {children}
            </KeyboardScrollProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
