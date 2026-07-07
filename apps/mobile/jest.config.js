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
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/react-native-skia|react-native-mmkv|ffmpeg-kit-react-native|react-native-google-mobile-ads|react-native-purchases|react-native-svg))",
  ],
};
