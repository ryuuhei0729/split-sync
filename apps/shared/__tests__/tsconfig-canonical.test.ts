/**
 * [3リポ同期の不変条件]
 * このファイルは以下の2ファイルと同じ canonical 値をリテラルで重複定義している。
 * 3リポは独立した git リポジトリのため、単一の CI で跨リポの一致を検証することは
 * 原理的に不可能。canonical 値を変更するときは、この3ファイルすべてを手動で更新すること。
 *   - swim-hub/apps/shared/__tests__/tsconfig-canonical.test.ts
 *   - swimhub-scanner/apps/shared/__tests__/tsconfig-canonical.test.ts
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Sprint #14 (target / strictness 統一) の設定ドリフト検知テスト。
 *
 * 何を検証するか、なぜここに置くか: swim-hub/apps/shared/__tests__/tsconfig-canonical.test.ts の
 * 冒頭コメントを参照。同じ設計をこのリポジトリに適用している。
 *
 * ここに置く理由 (CI から実行される場所):
 *   swimhub-timer/.github/workflows/ci.yml の `test` ジョブは `pnpm test` (= `turbo test`) を
 *   呼び、turbo は workspace 内の全パッケージの `test` script を実行する。apps/shared の
 *   `"test": "vitest run"` を通じて確実に CI で走る。
 *
 * 既知の限界 (QA report 参照):
 *   - swimhub-timer/apps/mobile は `expo/tsconfig.base` を直接 extends しており、
 *     `tsconfig.base.json` の変更の影響を受けない。forceConsistentCasingInFileNames と
 *     isolatedModules は PM_RULINGS.md 論点10により「今スプリントでは対応しない残債務」であり、
 *     このテストでは意図的に assert しない (将来対応時にここへ追記すること)。
 *   - swimhub-timer/apps/mobile の lib の最終形 (ES2022+DOM に揃えるか ESNext+DOM のままか) は
 *     PM_RULINGS.md に明記が無い。DOM が含まれることだけを弱く assert し、正確な集合は assert しない。
 *   - swimhub-timer/apps/web の jsx は現在 "react-jsx" だが、PM_RULINGS.md の「各web: jsx: preserve」は
 *     恐らく target/strictness 統一の対象外にある既存の app-level override で、#14 のスコープ外の
 *     矛盾に見える。誤って assert すると実際の意図的な設定を破壊した判定になりかねないため、
 *     jsx はこのプロジェクトに限り assert しない (QA report で PM に確認を仰ぐ)。
 */

// tsc は `npx` 経由でなく `node <tscの実パス>` で直接起動する。
// npx は `--no-install` でも npm CLI 自体をロードするため、低速な CI runner では
// tsc 本体を上回る起動コストを毎回払うことになる (既定 5s タイムアウトを
// 超えて CI が落ちた実例あり)。typescript はこの workspace の devDependency なので
// 解決はローカルで完結し、ネットワークアクセスも発生しない。
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");

// tsc の起動は 1 回あたり数百 ms かかる。CI runner の遅さ (ローカルの 3〜5 倍) と
// 初回実行の cold start を吸収するため、各 it に既定 (5s) より長いタイムアウトを与える。
// これは遅いテストを黙らせるためではなく、設定ドリフト検知の失敗を
// マシン速度に依存させないため。
const TSC_TIMEOUT_MS = 30_000;

function showConfig(relTsconfigPath: string): Record<string, unknown> {
  const cfgPath = path.resolve(process.cwd(), relTsconfigPath);
  const out = execFileSync(process.execPath, [tscPath, "--showConfig", "-p", cfgPath], {
    encoding: "utf8",
  });
  return (JSON.parse(out).compilerOptions ?? {}) as Record<string, unknown>;
}

function normalizeLib(lib: unknown): string[] {
  if (!Array.isArray(lib)) return [];
  return [...lib].map((x) => String(x).toLowerCase()).sort();
}

const CANONICAL_CORE = {
  module: "esnext",
  moduleResolution: "bundler",
  strict: true,
  noUncheckedIndexedAccess: true,
  esModuleInterop: true,
  skipLibCheck: true,
  forceConsistentCasingInFileNames: true,
  resolveJsonModule: true,
  isolatedModules: true,
};

describe("Sprint #14 tsconfig canonical values (swimhub-timer)", () => {
  it("apps/web: target ES2022 + canonical strictness + lib(dom,dom.iterable,es2022) + plugins next", () => {
    const co = showConfig("../web/tsconfig.json");
    expect(co).toMatchObject({ ...CANONICAL_CORE, target: "es2022" });
    expect(normalizeLib(co.lib)).toEqual(["dom", "dom.iterable", "es2022"]);
    expect(co.plugins).toMatchObject([{ name: "next" }]);
    // jsx は意図的に assert しない (ファイル冒頭コメント参照)。
  }, TSC_TIMEOUT_MS);

  it("apps/mobile: target/module の逸脱 (esnext/preserve) は維持。noUncheckedIndexedAccess のみ新規に true化", () => {
    const co = showConfig("../mobile/tsconfig.json");
    // PM_RULINGS.md 第3部「維持する per-project 逸脱」:
    // 「swimhub-timer/apps/mobile: target: esnext (ESNext ⊇ ES2022 なので変更不要),
    //  module: preserve（今回は維持するが「正当」とは言えない — 論点10・第2部参照）」
    expect(co.target).toBe("esnext");
    expect(co.module).toBe("preserve");
    expect(co.moduleResolution).toBe("bundler");
    expect(co.strict).toBe(true);
    expect(co.noUncheckedIndexedAccess).toBe(true);
    expect(co.esModuleInterop).toBe(true);
    expect(co.skipLibCheck).toBe(true);
    expect(co.resolveJsonModule).toBe(true);
    expect(co.jsx).toBe("react-native");
    // lib の正確な集合は assert しない。DOM を失っていないことだけを弱く確認する
    // (swim-hub/apps/shared と同種の landmine を、確定していない範囲で最小限に防ぐ)。
    expect(normalizeLib(co.lib)).toContain("dom");
    // forceConsistentCasingInFileNames / isolatedModules は
    // apps/mobile/tsconfig.json に直接指定を追加済み (PM_RULINGS.md 論点10対応済み)。
    expect(co.forceConsistentCasingInFileNames).toBe(true);
    expect(co.isolatedModules).toBe(true);
  }, TSC_TIMEOUT_MS);

  it("apps/shared (自身): target ES2022 + canonical strictness + lib は ES2022 のみ (library系)", () => {
    const co = showConfig("./tsconfig.json");
    expect(co).toMatchObject({ ...CANONICAL_CORE, target: "es2022" });
    expect(normalizeLib(co.lib)).toEqual(["es2022"]);
    expect(co.declaration).toBe(true);
    expect(co.declarationMap).toBe(true);
    expect(co.sourceMap).toBe(true);
  }, TSC_TIMEOUT_MS);

  it("packages/i18n: target ES2022 + module ESNext (es6 の設定漏れを修正) + canonical strictness + lib(es2022)", () => {
    const co = showConfig("../../packages/i18n/tsconfig.json");
    // PM_RULINGS.md 論点9: 「swimhub-timer/packages/i18n の module: es6 → ESNext に修正する
    // (逸脱ではなく単純な設定漏れ。module を上書きしておらず target=es2017 の暗黙既定に落ちている)」
    expect(co).toMatchObject({ ...CANONICAL_CORE, target: "es2022" });
    expect(normalizeLib(co.lib)).toEqual(["es2022"]);
    expect(co.declaration).toBe(true);
    expect(co.declarationMap).toBe(true);
    expect(co.sourceMap).toBe(true);
  }, TSC_TIMEOUT_MS);
});
