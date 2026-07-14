/* Mocks for native modules so test files that import them don't crash on load.
 * Extend as component tests are implemented. */
/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => {
    const store = new Map();
    return {
      getString: (k) => store.get(k) ?? undefined,
      set: (k, v) => store.set(k, v),
      remove: (k) => store.delete(k),
      clearAll: () => store.clear(),
    };
  },
}));

jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    logIn: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: "DEBUG" },
}));

jest.mock("react-native-google-mobile-ads", () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn() }),
  RewardedAd: { createForAdRequest: jest.fn() },
  RewardedAdEventType: {},
  TestIds: {},
}));

jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
