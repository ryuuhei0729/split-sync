import {
  extractTokensFromUrl as sharedExtractTokensFromUrl,
  getRedirectUri as sharedGetRedirectUri,
} from "@ryuuhei0729/swimhub-oauth/mobile";

export { claimOAuthCode, signInWithGoogle } from "@ryuuhei0729/swimhub-oauth/mobile";

/**
 * このアプリのカスタム URL スキーム。Google OAuth のリダイレクト (getRedirectUri /
 * hooks/useGoogleAuth.ts の signInWithGoogle 呼び出しの `scheme`) と、メール確認・
 * パスワードリセットのディープリンク (`swimhubtimer://auth/callback`, app/_layout.tsx
 * 参照) の両方が同じ値を前提にしている。ハードコード箇所を1つに集約し、将来
 * スキームを変更する際の取りこぼしを防ぐ (Reviewer 指摘)。
 */
export const APP_SCHEME = "swimhubtimer";

/**
 * リダイレクトURIを生成
 * カスタムスキーム(swimhubtimer://)を使用
 *
 * 共有パッケージ (@ryuuhei0729/swimhub-oauth/mobile) の getRedirectUri は scheme
 * を引数に取る1引数シグネチャだが、hooks/useEmailAuth.ts が0引数のまま import
 * しているため、scheme を APP_SCHEME に固定した0引数ラッパーとして維持する。
 */
export const getRedirectUri = (): string => sharedGetRedirectUri(APP_SCHEME);

/**
 * Supabase メールテンプレートの `token_hash` 形式で使われる検証タイプ。
 * `invite` は本アプリのフローで使わないため対象外とする。
 *
 * メール確認/パスワードリセットの token_hash 判定は Google OAuth 専用の
 * 共有パッケージのスコープ外のため、ロジック変更なしでそのまま残す。
 */
export type EmailOtpLinkType = "signup" | "recovery" | "email_change" | "email" | "magiclink";

const EMAIL_OTP_LINK_TYPES: readonly EmailOtpLinkType[] = [
  "signup",
  "recovery",
  "email_change",
  "email",
  "magiclink",
];

export const isEmailOtpLinkType = (value: unknown): value is EmailOtpLinkType =>
  typeof value === "string" && (EMAIL_OTP_LINK_TYPES as readonly string[]).includes(value);

/**
 * コールバックURLからトークン (または PKCE の認可コード) を抽出する。
 *
 * app/_layout.tsx の completeAuthDeepLink がパスワードリセット判定に
 * `recoveryType` を使うため、共有パッケージの既定 (false) を上書きして常に
 * 含める (includeRecoveryType: true)。これを省略すると recoveryType が常に
 * null になりパスワードリセット判定が壊れる。
 */
export const extractTokensFromUrl = (url: string) =>
  sharedExtractTokensFromUrl(url, { includeRecoveryType: true });
