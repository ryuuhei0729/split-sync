import type { InitOptions } from "i18next";
import ja from "./locales/ja";
import en from "./locales/en";
import ko from "./locales/ko";
import zh from "./locales/zh";
import de from "./locales/de";

export const supportedLocales = ["ja", "en", "zh", "ko", "de"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "ja";
export const DEVICE_FALLBACK_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (supportedLocales as readonly string[]).includes(value);
}

export const i18nResources = {
  ja: { translation: ja },
  en: { translation: en },
  ko: { translation: ko },
  zh: { translation: zh },
  de: { translation: de },
} as const;

export function getI18nOptions(lng: SupportedLocale): InitOptions {
  return {
    lng,
    fallbackLng: defaultLocale,
    resources: i18nResources,
    interpolation: {
      escapeValue: false,
    },
    compatibilityJSON: "v4",
    returnNull: false,
    react: { useSuspense: false },
  };
}
