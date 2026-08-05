/** Jest config for the mobile app (jest-expo preset). */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  // Resolve the workspace TS packages to their source so babel-jest transforms
  // them (they ship raw .ts via package "main", not a compiled build).
  moduleNameMapper: {
    "^@swimhub-timer/shared$": "<rootDir>/../shared/index.ts",
    "^@swimhub-timer/shared/(.*)$": "<rootDir>/../shared/$1",
    "^@swimhub-timer/i18n$": "<rootDir>/../../packages/i18n/src/index.ts",
  },
  transformIgnorePatterns: [
    // @ryuuhei0729/swimhub-oauth (3アプリ共通 OAuth パッケージ) は ESM を出力しているため、
    // 他の RN エコシステムパッケージ (下記の許可リスト参照) と同様に babel-jest での
    // トランスパイル対象に含める必要がある。Jest は CJS ベースの require() で動くため、
    // 拡張子の有無とは無関係に生の import/export 構文をパースできない。
    //
    // NOTE: この1行を消すために配布形式を CJS に変えると (v0.1.1 で試行)、今度は Vitest 側で
    // vi.mock("@supabase/ssr") が共有パッケージ内部に届かず web の33テストが落ちる。
    // 統制実験で確認済み: ESM=web 327 passed / CJS=web 33 failed。ESM 維持が正しい。
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/react-native-skia|react-native-mmkv|ffmpeg-kit-react-native|react-native-google-mobile-ads|react-native-purchases|react-native-svg|@ryuuhei0729/.*))",
  ],
};
