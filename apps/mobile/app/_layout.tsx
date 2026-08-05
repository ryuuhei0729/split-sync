import { useEffect, useRef } from "react";
import { I18nProvider } from "../providers/I18nProvider";
import { View, ActivityIndicator, StyleSheet, Alert } from "react-native";
import * as Linking from "expo-linking";
import { Slot, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Font from "expo-font";
import { ChakraPetch_700Bold } from "@expo-google-fonts/chakra-petch";
import { AuthProvider, useAuth } from "../contexts/AuthProvider";
import { supabase } from "../lib/supabase";
import { extractTokensFromUrl, isEmailOtpLinkType, claimOAuthCode } from "../lib/google-auth";
import { setPasswordRecoveryPending, usePasswordRecoveryPending } from "../lib/passwordRecovery";
import { colors } from "../lib/theme";
import i18n from "../lib/i18n";
import { localizeAuthError } from "../utils/authErrorLocalizer";

/**
 * Completes auth deep links (email confirmation / password reset).
 *
 * Supabase's email templates now emit `swimhubtimer://auth/callback?token_hash=…&type=…`
 * (project-wide setting) — this is checked first and verified via verifyOtp,
 * which works for both signup confirmation and password recovery. `type`
 * itself tells us the flow, so no extra query marker is needed on redirectTo.
 *
 * `?code=…` (PKCE) callbacks at this same `auth/callback` URL are usually
 * Google OAuth's — `useGoogleAuth` normally consumes those directly from the
 * `openAuthSessionAsync` result URL. But this handler is also a *safety net*
 * for that flow: Android can deliver the callback here via a `Linking` 'url'
 * event even when `openAuthSessionAsync` resolves with `dismiss`/no URL (its
 * Custom Tab returned via a fresh Intent) or never resolves at all (the app
 * process was killed while the Custom Tab was open — `useGoogleAuth`'s
 * in-memory state is lost, but the OS still redelivers the deep link here on
 * relaunch). Without this fallback those logins would fail silently with no
 * recovery path, which is worse than the alternative below.
 *
 * Both entry points can therefore see the exact same single-use `code`, so
 * `claimOAuthCode` (lib/google-auth.ts) arbitrates: whichever side calls it
 * first gets `true` and performs the exchange; the loser gets `false` and
 * does nothing silently (no error) — the flow already succeeded via the
 * other path. Without this, the same `code` gets exchanged twice and the
 * second exchange always fails, surfacing a bogus auth error to an
 * already-signed-in user (PM-verified Critical). Since the `token_hash`
 * branch above already returns for anything with a `token_hash`, any `code`
 * reaching this point is assumed to be an OAuth callback.
 * Fragment tokens (implicit flow) are still handled below as a last-resort
 * fallback.
 * Without handling these the link opened the web LP and the sign-up happy
 * path dead-ended.
 *
 * Password recovery links use the same callback URL, so we flag them via
 * setPasswordRecoveryPending *before* establishing the session — AuthGate
 * reads that flag to route to /(auth)/reset-password instead of /(app).
 *
 * If session establishment then fails (expired/reused link, thrown error),
 * the flag is cleared again — otherwise a stale "recovery pending" flag would
 * hijack the user's *next*, unrelated normal sign-in and bounce them to
 * reset-password. Only cleared when *this* call set it, so an unrelated
 * confirmation-link failure never wipes out a real pending recovery.
 */
async function completeAuthDeepLink(url: string | null): Promise<void> {
  if (!url || !supabase || !url.includes("auth/callback")) return;
  let flaggedRecoveryInThisCall = false;
  try {
    // Use expo-linking's parser: React Native's URL.searchParams is unreliable
    // (google-auth builds URLSearchParams from the hash by hand for the same
    // reason), so parse queryParams the RN-safe way.
    const queryParams = Linking.parse(url).queryParams;

    const typeParam = queryParams?.type;
    const emailOtpType = isEmailOtpLinkType(typeParam) ? typeParam : null;

    // 新形式: Supabase メールテンプレートの token_hash + type。code / fragment
    // token より先にチェックし、両方揃う場合は token_hash を優先する。
    const tokenHashParam = queryParams?.token_hash;
    const tokenHash = typeof tokenHashParam === "string" ? tokenHashParam : null;

    if (tokenHash && emailOtpType) {
      if (emailOtpType === "recovery") {
        setPasswordRecoveryPending(true);
        flaggedRecoveryInThisCall = true;
      }
      const { error } = await supabase.auth.verifyOtp({
        type: emailOtpType,
        token_hash: tokenHash,
      });
      if (error && flaggedRecoveryInThisCall) {
        setPasswordRecoveryPending(false);
      }
      return;
    }

    const codeParam = queryParams?.code;
    const code = typeof codeParam === "string" ? codeParam : null;

    // type=recovery クエリでパスワードリセットリンクを判別する
    // (旧 flow=password-recovery マーカーから置き換え。redirectTo はクエリなしで
    // 統一したためマーカーは付与されなくなった)
    const isRecoveryLink = emailOtpType === "recovery";

    // Google OAuth コールバック (`?code=...`)。token_hash 分岐は上で既に
    // リターン済みなので、ここに到達する code は OAuth 由来とみなしてよい。
    // useGoogleAuth (openAuthSessionAsync の戻り URL) と、この Linking
    // グローバルハンドラの両方に同一 code が届きうる (Android で Custom Tabs
    // 復帰が新規 Intent になった場合や、ブラウザ表示中のプロセス kill から
    // 復帰した場合)。claimOAuthCode で「最初に処理を claim した側だけが
    // 交換する」を保証し、後から来た側は既に成功している前提でエラーを
    // 出さず何もしない (claim/交換の間に await を挟まないこと)。
    if (code) {
      const claim = claimOAuthCode(code);
      if (!claim.claimed) {
        // useGoogleAuth 側が既にこの code を claim 済み。ここでは実際の交換結果を
        // 通知する義務は無い (成功時は何もしない設計のまま。失敗時は useGoogleAuth
        // 側が claim.result を見て自前でエラー表示するため、二重通知は避ける)。
        return;
      }
      if (isRecoveryLink) {
        setPasswordRecoveryPending(true);
        flaggedRecoveryInThisCall = true;
      }
      try {
        // exchangeCodeForSession doesn't throw for an expired/reused code — it
        // resolves with `error` set — so we must check it explicitly, not just catch.
        // A null `error` alone isn't sufficient either: the warm path (useGoogleAuth
        // → the shared package's signInWithGoogle) treats `error:null` with no
        // `session` as a failure (`session_not_received`). Without mirroring that
        // check here, the exact same expired/stale code could resolve as a failure
        // via one path and a silent "success" via the other, depending on which
        // side wins claimOAuthCode below — the same claim-race asymmetry this
        // refactor exists to remove (PM-verified).
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.session) {
          claim.resolve({ success: false });
          if (flaggedRecoveryInThisCall) {
            setPasswordRecoveryPending(false);
          }
          // この分岐は claimOAuthCode に勝った (= 実際にこの code を交換しようとした)
          // 側でのみ到達する。PKCE 化により、この安全網経路が Google サインインの
          // 主経路として実際に発火するようになったため、失敗時に無言のままだと
          // ユーザーがログイン画面に戻されただけで原因が分からず再試行するしかない
          // (Reviewer Warning)。claim に負けた側 (上の `if (!claim.claimed)`)
          // は正常系なのでここには来ない — エラー表示するのは実際に交換を試みて
          // 失敗した場合のみ。
          // i18next の `t` は内部で `this` (this.translator) に依存するため、
          // 素の関数参照 (`i18n.t`) をそのまま渡すと `this` が失われて壊れる。
          // `.bind(i18n)` で常に `i18n` を receiver にして呼び出す。
          Alert.alert(
            i18n.t("common.error"),
            error
              ? localizeAuthError(error.message, i18n.t.bind(i18n))
              : i18n.t("auth.errors.sessionNotFound"),
          );
          return;
        }
        claim.resolve({ success: true });
      } catch (exchangeException) {
        claim.resolve({ success: false });
        throw exchangeException;
      }
      return;
    }
    const tokens = extractTokensFromUrl(url);
    if (tokens.accessToken && tokens.refreshToken) {
      if (isRecoveryLink || tokens.recoveryType === "recovery") {
        setPasswordRecoveryPending(true);
        flaggedRecoveryInThisCall = true;
      }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (error && flaggedRecoveryInThisCall) {
        setPasswordRecoveryPending(false);
      }
    }
  } catch {
    // Invalid/expired link — leave the user on the auth screen to retry.
    if (flaggedRecoveryInThisCall) {
      setPasswordRecoveryPending(false);
    }
  }
}

// Load the same fonts used by the FFmpeg exporter so the preview matches the
// rendered video. NotoSansJP-Bold is the sans-serif default — its glyph set
// covers Japanese as well as Latin, which the timer's memo overlay needs.
// NotoSansMono-Bold is used when the user picks monospace (Latin only).
// ChakraPetch_700Bold is used for the brand wordmark on the welcome screen.
// Best-effort: failures fall back to the system font.
Font.loadAsync({
  "NotoSansJP-Bold": require("../assets/fonts/NotoSansJP-Bold.ttf"),
  "NotoSansMono-Bold": require("../assets/fonts/NotoSansMono-Bold.ttf"),
  ChakraPetch_700Bold,
}).catch(() => {});

function AuthGate() {
  const { user, isAuthenticated, guestMode, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const redirectDone = useRef(false);
  const prevAuthStateRef = useRef({ user: !!user, guestMode });
  const passwordRecoveryPending = usePasswordRecoveryPending();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";
    // segments is a typed tuple keyed to the app's route structure, so its
    // length/shape varies per route — widen to a plain array before indexing
    // an arbitrary position to avoid a "no element at index" type error.
    const segmentList: readonly string[] = segments;
    const isOnResetPasswordScreen = inAuthGroup && segmentList[1] === "reset-password";

    // 常時ガード (redirectDone の one-shot ゲートより前に評価する): リカバリー
    // セッションが有効な間は reset-password 以外のどの画面に居ても押し戻す。
    // redirectDone は認証状態が変わるまで再チェックしないため、スワイプバック
    // や他コンポーネントの router.replace で reset-password から離脱されると
    // パスワード未変更のまま素通りできてしまう — この分岐はそれを防ぐため
    // redirectDone に依存させず、segments が変わるたびに毎回評価する。
    if (passwordRecoveryPending && !!user && !isOnResetPasswordScreen) {
      router.replace("/(auth)/reset-password");
      return;
    }

    // 認証状態が変化したときだけリダイレクトフラグをリセット
    const prevUser = prevAuthStateRef.current.user;
    const prevGuestMode = prevAuthStateRef.current.guestMode;
    if (prevUser !== !!user || prevGuestMode !== guestMode) {
      redirectDone.current = false;
      prevAuthStateRef.current = { user: !!user, guestMode };
    }

    if (redirectDone.current) return;

    if (!isAuthenticated && !guestMode && !inAuthGroup) {
      // 未認証・非ゲスト・非authグループ → get-started へリダイレクト
      redirectDone.current = true;
      router.replace("/(auth)/get-started");
    } else if (!!user && inAuthGroup) {
      // パスワードリセットリンクで確立したセッションは、通常ログインと違い
      // reset-password 画面へ誘導する (completeAuthDeepLink が事前にフラグを立てる)。
      // 通常はこの分岐に到達する前に上の常時ガードが処理するが、念のため残す。
      redirectDone.current = true;
      router.replace(passwordRecoveryPending ? "/(auth)/reset-password" : "/(app)");
    }
  }, [user, isAuthenticated, guestMode, loading, segments, router, passwordRecoveryPending]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  useEffect(() => {
    try {
      const mobileAds = require("react-native-google-mobile-ads").default;
      mobileAds().initialize();
    } catch {
      // Ad module not available (e.g., running in Expo Go)
    }
  }, []);

  // Complete auth deep links (email confirmation / password reset): the cold-
  // start URL plus any received while the app is open.
  useEffect(() => {
    Linking.getInitialURL().then(completeAuthDeepLink);
    const sub = Linking.addEventListener("url", (e) => completeAuthDeepLink(e.url));
    return () => sub.remove();
  }, []);

  return (
    <I18nProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <AuthGate />
      </AuthProvider>
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
});
