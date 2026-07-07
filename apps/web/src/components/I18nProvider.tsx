"use client";

import { useEffect } from "react";
import i18next from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { getI18nOptions, defaultLocale, type SupportedLocale } from "@swimhub-timer/i18n";

// Locale resources are bundled statically (no async backend), so with
// `initImmediate: false` this call processes its resources synchronously —
// i18next can translate immediately after `init()` returns, without
// waiting for the returned promise. This runs at module scope (not inside
// an effect) so it also happens during SSR, where effects never run.
if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({ ...getI18nOptions(defaultLocale), initImmediate: false });
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: SupportedLocale;
  children: React.ReactNode;
}) {
  // Sync language during render (not just in the effect below) so the very
  // first render — including on the server — already reflects the page's
  // locale instead of rendering nothing until an effect can run.
  if (i18next.language !== locale) {
    i18next.changeLanguage(locale);
  }

  useEffect(() => {
    if (i18next.language !== locale) {
      i18next.changeLanguage(locale);
    }
  }, [locale]);

  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
}
