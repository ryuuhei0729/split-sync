import type { InitOptions } from "i18next";
import ja from "./locales/ja";
import en from "./locales/en";

export const supportedLocales = ["ja", "en"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "ja";
export const DEVICE_FALLBACK_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(
  value: unknown
): value is SupportedLocale {
  return typeof value === "string" && (supportedLocales as readonly string[]).includes(value);
}

export const i18nResources = {
  ja: { translation: ja },
  en: { translation: en },
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
