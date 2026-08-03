/**
 * claimOAuthCode (lib/google-auth.ts) の単体テスト
 *
 * PM 依頼4-1 (C-5 二重交換防止ロジックの穴埋め):
 * app/_layout.tsx のグローバル Linking ハンドラと hooks/useGoogleAuth.ts の両方に
 * 同一の PKCE 認可コードが届きうるため、claimOAuthCode は「最初に claim した側だけ
 * true を返す」ことで二重の exchangeCodeForSession 呼び出し (= 2回目が必ず失敗し
 * 既にログイン済みのユーザーに偽エラーを見せる Critical) を防ぐ。この関数自体が
 * 無テストだったため、契約と挙動を直接固定する。
 *
 * 注意 (App Developer 申し送り): claimedOAuthCodes はモジュールスコープの配列で
 * テスト間でリセットされない (プロダクションコードにテスト専用のリセット口は
 * 開けない方針)。同一 code 文字列を複数の it で使い回すと、既に他のテストが
 * 消費した状態が残り意図しない false が返るため、各テストケースで一意な
 * code 文字列を用いる。
 */
import { claimOAuthCode } from "../lib/google-auth";

describe("claimOAuthCode", () => {
  it("同一 code を2回渡すと1回目 true・2回目 false を返す", () => {
    const code = "claim-test-same-code-001";
    expect(claimOAuthCode(code)).toBe(true);
    expect(claimOAuthCode(code)).toBe(false);
  });

  it("異なる code ならどちらも true を返す (それぞれ独立した OAuth コールバックとして扱われる)", () => {
    expect(claimOAuthCode("claim-test-diff-code-a")).toBe(true);
    expect(claimOAuthCode("claim-test-diff-code-b")).toBe(true);
  });

  it("同一 code への3回目以降の呼び出しも false のままである (消費済み状態が固定される)", () => {
    const code = "claim-test-same-code-002";
    expect(claimOAuthCode(code)).toBe(true);
    expect(claimOAuthCode(code)).toBe(false);
    expect(claimOAuthCode(code)).toBe(false);
  });

  it("MAX_TRACKED_CODES (5件) を超えると最も古いものが追い出され、再度 true で claim できる", () => {
    const codes = [
      "claim-test-evict-1",
      "claim-test-evict-2",
      "claim-test-evict-3",
      "claim-test-evict-4",
      "claim-test-evict-5",
      "claim-test-evict-6",
    ];
    // 6件を連続で新規 claim する。新規 code なのでどれも true。
    for (const code of codes) {
      expect(claimOAuthCode(code)).toBe(true);
    }
    // 6件目の push で保持数が5を超え、最も古い1件目 (evict-1) が追い出される
    // (この時点で他のテストからの残留エントリがあっても、6件連続で新規 push すれば
    // 直近5件だけが残る仕様のため、evict-1 の追い出しは確定的に発生する)。
    // 追い出された code は「未処理」扱いに戻るため、再度 claim すると true になる。
    expect(claimOAuthCode("claim-test-evict-1")).toBe(true);

    // この再 claim 自体が新規 push のため、今度は evict-2 が追い出される。
    // 一方 evict-6 (直近に push されたもの) はまだ保持されているため false のまま。
    expect(claimOAuthCode("claim-test-evict-6")).toBe(false);
  });
});
