import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_JP, Noto_Sans_KR, Noto_Sans_SC, Chakra_Petch } from "next/font/google";
import { notFound } from "next/navigation";
import { I18nProvider } from "@/components/I18nProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { KeyboardScrollProvider } from "@/components/keyboard/KeyboardScrollProvider";
import { supportedLocales, i18nResources, isSupportedLocale, type SupportedLocale } from "@swimhub-timer/i18n";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 日本語 / 韓国語 (ハングル) / 簡体字中国語のグリフ用。
// globals.css の base --font-sans (ja) と html:lang(ko) / html:lang(zh) でそれぞれ優先する。
// preload: false — :lang() で条件適用のため全ユーザーへの preload は不要
const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
  preload: false,
});

const notoSansKR = Noto_Sans_KR({
  subsets: ["latin"],
  variable: "--font-noto-sans-kr",
  weight: ["400", "500", "700"],
  preload: false,
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  weight: ["400", "500", "700"],
  preload: false,
});

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-chakra-petch",
  weight: ["600", "700"],
});

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
        ...Object.fromEntries(supportedLocales.map((l) => [l, `/${l}`])),
        "x-default": "/ja",
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
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable} ${notoSansJP.variable} ${notoSansKR.variable} ${notoSansSC.variable} ${chakraPetch.variable} h-full`}
    >
      <body className="h-full antialiased">
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
