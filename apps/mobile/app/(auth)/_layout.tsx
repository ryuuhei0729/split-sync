import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#EFF6FF" },
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="get-started" />
      <Stack.Screen name="login-method" />
      <Stack.Screen name="email-login" />
      <Stack.Screen name="email-signup" />
      <Stack.Screen name="forgot-password" />
      {/* リカバリーセッションが確立している間はパスワード未変更のまま離脱でき
          ないよう、スワイプバックを無効化する (多層防御。主対策は AuthGate の
          常時ガード — completeAuthDeepLink/AuthGate 参照)。 */}
      <Stack.Screen name="reset-password" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
