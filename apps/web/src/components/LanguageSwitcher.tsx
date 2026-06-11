"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { supportedLocales, isSupportedLocale, defaultLocale } from "@swimhub-timer/i18n";
import type { SupportedLocale } from "@swimhub-timer/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const localeLabels: Record<SupportedLocale, string> = {
  ja: "日本語",
  en: "English",
  zh: "简体中文",
  ko: "한국어",
  de: "Deutsch",
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, i18n } = useTranslation();

  const rawSegment = pathname.split("/")[1];
  const currentLocale: SupportedLocale = isSupportedLocale(rawSegment) ? rawSegment : defaultLocale;

  const switchedPath = (locale: SupportedLocale) => {
    const segments = pathname.split("/");
    segments[1] = locale;
    return segments.join("/");
  };

  const handleSwitch = async (locale: string) => {
    if (!isSupportedLocale(locale) || locale === currentLocale) return;
    try {
      await i18n.changeLanguage(locale);
    } catch (err) {
      console.error("[LanguageSwitcher] changeLanguage failed:", err);
    }
    router.replace(switchedPath(locale));
  };

  return (
    <Select value={currentLocale} onValueChange={handleSwitch}>
      <SelectTrigger
        size="sm"
        aria-label={t("common.language")}
        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground border-none bg-transparent shadow-none px-2"
      >
        <Globe className="size-3.5" aria-hidden="true" />
        <span>{t("common.language")}</span>
      </SelectTrigger>
      <SelectContent align="end">
        {supportedLocales.map((locale) => (
          <SelectItem
            key={locale}
            value={locale}
            className={locale === currentLocale ? "font-medium text-foreground" : ""}
          >
            {localeLabels[locale]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
