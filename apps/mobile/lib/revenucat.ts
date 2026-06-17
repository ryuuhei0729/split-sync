/**
 * RevenueCat SDK ラッパー
 * iOS は App Store (appl_ キー)、Android は Google Play (goog_ キー) を使用する。
 * プラットフォームに対応する有効なAPIキーが設定されている場合のみ初期化する。
 * キー未設定（または無効）の場合は全操作を no-op とし、課金UIを無効化する。
 */
import { Platform } from "react-native";
import Purchases, {
  type PurchasesPackage,
  type CustomerInfo,
  type PurchasesOfferings,
} from "react-native-purchases";

const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUCAT_IOS_API_KEY ?? "",
  android: process.env.EXPO_PUBLIC_REVENUCAT_ANDROID_API_KEY ?? "",
  default: "",
});
const EXPECTED_PREFIX = Platform.select({ ios: "appl_", android: "goog_", default: "" });

const isValidApiKey =
  !!API_KEY && !!EXPECTED_PREFIX && API_KEY.startsWith(EXPECTED_PREFIX);

let isInitialized = false;

/** SDK を初期化する（対応プラットフォームの有効なAPIキーがある場合のみ） */
export async function initRevenueCat(): Promise<void> {
  if (isInitialized) return;
  if (!isValidApiKey) {
    console.log(`[RevenueCat] ${Platform.OS} 用APIキー未設定のため初期化をスキップします`);
    return;
  }

  try {
    Purchases.configure({ apiKey: API_KEY! });
    isInitialized = true;
  } catch (err) {
    console.error("[RevenueCat] 初期化エラー:", err);
  }
}

/** Supabase user.id で RevenueCat にログインする */
export async function loginRevenueCat(userId: string): Promise<void> {
  if (!isInitialized) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.error("[RevenueCat] ログイン失敗:", error);
  }
}

/** RevenueCat からログアウトする */
export async function logoutRevenueCat(): Promise<void> {
  if (!isInitialized) return;
  try {
    await Purchases.logOut();
  } catch (error) {
    console.error("[RevenueCat] ログアウト失敗:", error);
  }
}

/** 利用可能なオファリングを取得する */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!isInitialized) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings;
  } catch (error) {
    console.error("[RevenueCat] オファリング取得失敗:", error);
    return null;
  }
}

/** パッケージを購入する */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo | null> {
  if (!isInitialized) return null;
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo;
  } catch (err: unknown) {
    // ユーザーがキャンセルした場合はエラーとして扱わない
    if (err && typeof err === "object" && "userCancelled" in err && err.userCancelled) {
      return null;
    }
    throw err;
  }
}

/** 購入をリストアする */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isInitialized) return null;
  try {
    const customerInfo = await Purchases.restorePurchases();
    return customerInfo;
  } catch (error) {
    console.error("[RevenueCat] リストア失敗:", error);
    throw error;
  }
}

/** 顧客情報を取得する */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isInitialized) return null;
  try {
    const customerInfo = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (error) {
    console.error("[RevenueCat] 顧客情報取得失敗:", error);
    return null;
  }
}

/** 顧客情報の変更リスナーを登録する。クリーンアップ用の関数を返す */
export function addCustomerInfoUpdateListener(
  listener: (info: CustomerInfo) => void,
): () => void {
  if (!isInitialized) {
    return () => {};
  }

  Purchases.addCustomerInfoUpdateListener(listener);
  return () => {
    Purchases.removeCustomerInfoUpdateListener(listener);
  };
}
