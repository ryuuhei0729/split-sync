import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".next"],
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        // @ryuuhei0729/swimhub-oauth の handleAuthCallback は内部で next/headers の
        // cookies() を呼ぶ。外部依存のまま外に置くと vi.mock("next/headers") が
        // パッケージ内部に届かず実物が使われ、"cookies was called outside a request
        // scope" で落ちる。モックを効かせるには変換パイプラインに載せる必要がある。
        // (v0.1.1 で CJS 化したのでモジュール解決自体は inline なしでも通る。
        //  これはモック適用のための設定であって、パッケージ側の不具合ではない)
        inline: [/@ryuuhei0729\/swimhub-oauth/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", ".next/", "**/*.d.ts", "**/*.config.*"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
