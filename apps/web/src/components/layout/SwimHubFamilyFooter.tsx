"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Heart, ShieldCheck, FileText, HelpCircle, Mail, ExternalLink } from "lucide-react";

export function SwimHubFamilyFooter() {
  const { t } = useTranslation();
  const params = useParams();
  const locale = (params.locale as string) || "ja";
  const currentYear = new Date().getFullYear();

  const familyServices = [
    {
      name: "SwimHub",
      description: t("footer.swimhubDesc"),
      href: "https://swim-hub.app",
      iconSrc: "/swimhub-icon.png",
      current: false,
    },
    {
      name: "SwimHub Timer",
      description: t("footer.timerDesc"),
      href: "https://timer.swim-hub.app",
      iconSrc: "/icon.png",
      current: true,
    },
    {
      name: "SwimHub Scanner",
      description: t("footer.scannerDesc"),
      href: "https://scanner.swim-hub.app",
      iconSrc: "/scanner-icon.png",
      current: false,
    },
  ];

  const footerLinks = [
    {
      name: t("footer.privacyPolicy"),
      href: "/privacy",
      icon: ShieldCheck,
      external: false,
    },
    {
      name: t("footer.termsOfService"),
      href: "/terms",
      icon: FileText,
      external: false,
    },
    {
      name: t("footer.support"),
      href: "https://swim-hub.app/support",
      icon: HelpCircle,
      external: true,
    },
    {
      name: t("footer.contact"),
      href: "https://swim-hub.app/contact?app=timer",
      icon: Mail,
      external: true,
    },
    {
      name: t("footer.commercialLaw"),
      href: "https://swim-hub.app/tokushoho",
      icon: FileText,
      external: true,
    },
  ];

  return (
    <footer className="bg-white border-t border-gray-200 mt-auto">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* 左側：システム情報 */}
          <div className="space-y-4">
            <div className="flex items-center">
              <div className="w-6 h-6 flex items-center justify-center mr-2">
                <Image
                  src="/icon.png"
                  alt="SwimHub Timer"
                  width={24}
                  height={24}
                  className="w-full h-full object-contain"
                />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 font-(family-name:--font-chakra-petch)">SwimHub Timer</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              {t("footer.appDescription")}
            </p>
            <div className="flex items-center text-sm text-gray-500">
              <Heart className="h-4 w-4 text-red-500 mr-1" />
              <span>{t("footer.madeWithLove")}</span>
            </div>
          </div>

          {/* 右側：法的情報とサポート */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              {t("footer.supportInfo")}
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {footerLinks.map((link) =>
                link.external ? (
                  <a
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center text-sm text-gray-600 hover:text-blue-600 transition-colors duration-200"
                  >
                    <link.icon className="h-4 w-4 mr-2" />
                    {link.name}
                  </a>
                ) : (
                  <Link
                    key={link.name}
                    href={`/${locale}${link.href}`}
                    className="flex items-center text-sm text-gray-600 hover:text-blue-600 transition-colors duration-200"
                  >
                    <link.icon className="h-4 w-4 mr-2" />
                    {link.name}
                  </Link>
                ),
              )}
            </div>
          </div>
        </div>

        {/* SwimHub サービス一覧 */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 tracking-wide mb-4">
            {t("footer.serviceList")}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {familyServices.map((service) =>
              service.current ? (
                <div
                  key={service.name}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200"
                >
                  <Image
                    src={service.iconSrc}
                    alt={service.name}
                    width={128}
                    height={128}
                    className="w-32 h-32 shrink-0 object-contain"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-blue-700 font-(family-name:--font-chakra-petch)">{service.name}</span>
                      <span className="text-[10px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">
                        {t("footer.currentlyUsing")}
                      </span>
                    </div>
                    <p className="text-xs text-blue-600/70 truncate">{service.description}</p>
                  </div>
                </div>
              ) : (
                <a
                  key={service.name}
                  href={service.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300 transition-colors duration-200 group"
                >
                  <Image
                    src={service.iconSrc}
                    alt={service.name}
                    width={128}
                    height={128}
                    className="w-32 h-32 shrink-0 object-contain opacity-60 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-gray-700 group-hover:text-gray-900 font-(family-name:--font-chakra-petch)">
                        {service.name}
                      </span>
                      <ExternalLink className="w-3 h-3 text-gray-400 group-hover:text-gray-500" />
                    </div>
                    <p className="text-xs text-gray-500 truncate">{service.description}</p>
                  </div>
                </a>
              ),
            )}
          </div>
        </div>

        {/* 下部：コピーライトとバージョン情報 */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex flex-col items-center justify-between space-y-4 sm:flex-row sm:space-y-0">
            <div className="flex flex-col items-center sm:items-start space-y-1">
              <div className="text-sm text-gray-500">
                {t("footer.copyright", { year: currentYear })}
              </div>
              <div className="text-xs text-gray-400"></div>
            </div>

            <div className="flex items-center space-x-4 text-xs text-gray-400">
              <span>
                {t("footer.lastUpdated", {
                  date: new Date().toLocaleDateString(locale, {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }),
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
