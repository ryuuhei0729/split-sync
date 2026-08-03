import type { Metadata } from "next";
import { Chakra_Petch, Inter, Noto_Sans_JP, Playfair_Display } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { Home } from "lucide-react";

// Global 404: root layout が `<html>` を出さないため、ここで自前で出力する。
// (`<html>` `<body>` と Provider 群は app/[locale]/layout.tsx が担当)
// locale を判別できないため文言は日本語固定、リンクは locale なしパスで
// middleware の locale リダイレクトに委ねる。
//
// レイアウト: 左半分はコード実装、右半分は写真 (public/images/404-pool.jpg)。
// swim-hub / swimhub-scanner の 404 と同じ世界観を共有する。

// globals.css の --font-sans は --font-geist-sans (Inter) → --font-noto-sans-jp の順で参照する。
const inter = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans-jp",
  weight: ["400", "500", "700"],
});

const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  variable: "--font-chakra-petch",
  weight: ["500", "600", "700"],
});

// 404 の数字と "Take your mark." のみで使うディスプレイ用セリフ。
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "500"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// metadata.title は 404 (Next の error shell 経由) では head に出力されないため、
// React 19 の hoisting を使って <title> を直接描画する。
const TITLE = "404 - ページが見つかりません | SwimHub Timer";

export default function NotFound() {
  return (
    <html
      lang="ja"
      className={`h-full ${inter.variable} ${notoSansJP.variable} ${chakraPetch.variable} ${playfair.variable}`}
    >
      <body className="font-sans">
        <title>{TITLE}</title>
        <main className="relative min-h-dvh overflow-hidden bg-[#F4F8FD]">
          {/* 右半分の写真。lg 未満では全面に敷いてベールを重ねる */}
          <div className="absolute inset-y-0 right-0 left-0 lg:left-[50%]">
            {/* 画像取得前 / 取得失敗時のフォールバック */}
            <div className="absolute inset-0 bg-linear-to-br from-sky-100 via-white to-sky-50" />
            <Image
              src="/images/404-pool.jpg"
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-center"
            />
            {/* モバイル: 写真の上に文字を置くためのベール */}
            <div className="absolute inset-0 bg-linear-to-br from-[#F4F8FD]/94 via-[#F4F8FD]/88 to-[#F4F8FD]/72 lg:hidden" />
            {/* デスクトップ: 左パネルとの継ぎ目をぼかす */}
            <div className="absolute inset-y-0 left-0 hidden w-40 bg-linear-to-r from-[#F4F8FD] to-transparent lg:block xl:w-56" />
          </div>

          <div className="relative z-10 flex min-h-dvh flex-col justify-between px-6 py-10 sm:px-10 lg:w-[52%] lg:px-20 lg:py-14 xl:px-24">
            {/* ブランド: アプリ内と同じ表現 (アプリアイコン + Chakra Petch の "SwimHub Timer") */}
            <Link href="/" className="inline-flex w-fit items-center transition-opacity hover:opacity-80">
              <div className="mr-2 flex h-10 w-10 items-center justify-center">
                <Image
                  src="/icon.png"
                  alt=""
                  width={40}
                  height={40}
                  className="h-full w-full object-contain"
                />
              </div>
              <span className="font-(family-name:--font-chakra-petch) text-lg font-bold whitespace-nowrap text-gray-900 sm:text-2xl">
                SwimHub Timer
              </span>
            </Link>

            {/* 本文 */}
            <div className="py-10">
              <p className="font-(family-name:--font-playfair) bg-linear-to-b from-[#1E3A8A] via-[#2451C9] to-[#6BB6F0] bg-clip-text pb-[0.06em] text-[clamp(5.5rem,15vw,12rem)] leading-[0.95] tracking-[-0.02em] text-transparent">
                404
              </p>
              <p className="font-(family-name:--font-chakra-petch) mt-1 text-[clamp(1.4rem,4vw,2.9rem)] font-semibold tracking-[0.26em] text-[#1E3A8A]">
                WRONG LANE
              </p>

              <div className="mt-6 h-[3px] w-20 rounded-full bg-linear-to-r from-[#38BDF8] to-[#0EA5E9]" />

              <h1 className="mt-7 text-2xl font-bold tracking-tight text-balance text-gray-900 sm:text-3xl">
                コースを外れてしまったようです。
              </h1>
              <p className="mt-3 text-sm text-gray-600 sm:text-base">
                お探しのページは、移動または削除された可能性があります。
              </p>

              <div className="mt-9">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-[#2563EB] to-[#22D3EE] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition hover:shadow-xl hover:shadow-blue-500/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] focus-visible:ring-offset-2"
                >
                  <Home className="h-5 w-5" aria-hidden="true" />
                  ホームに戻る
                </Link>
              </div>
            </div>

            {/* フッター: 水面のライン + タグライン。装飾をフローに置いて文字と重ならないようにする */}
            <div>
              <svg
                aria-hidden="true"
                className="pointer-events-none mb-5 h-16 w-[40rem] max-w-none -translate-x-24 text-sky-300/60"
                viewBox="0 0 700 120"
                fill="none"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 30 Q 90 0 180 30 T 360 30 T 540 30 T 720 30"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M0 60 Q 90 30 180 60 T 360 60 T 540 60 T 720 60"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M0 90 Q 90 60 180 90 T 360 90 T 540 90 T 720 90"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="flex items-center gap-4">
                <span className="hidden h-px w-10 shrink-0 bg-sky-300 sm:block sm:w-16" />
                <p className="text-sm sm:text-base">
                  <span className="font-(family-name:--font-playfair) text-[#2563EB] italic">Take your mark.</span>{" "}
                  <span className="text-gray-600">もう一度、スタート地点へ。</span>
                </p>
                <span className="hidden h-px flex-1 bg-linear-to-r from-sky-300 to-transparent sm:block" />
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
