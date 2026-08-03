/**
 * claimOAuthCode (lib/google-auth.ts) の単体テスト
 *
 * PM 依頼4-1 (C-5 二重交換防止ロジックの穴埋め):
 * app/_layout.tsx のグローバル Linking ハンドラと hooks/useGoogleAuth.ts の両方に
 * 同一の PKCE 認可コードが届きうるため、claimOAuthCode は「最初に claim した側だけ
 * `claimed: true` を返す」ことで二重の exchangeCodeForSession 呼び出し (= 2回目が
 * 必ず失敗し既にログイン済みのユーザーに偽エラーを見せる Critical) を防ぐ。
 *
 * CodeRabbit 指摘 (PR #23): 単純な boolean 契約だと、負けた側は勝った側が実際に
 * 交換へ成功したかどうかを知れず、無条件で成功扱いを返してしまう。これを塞ぐため
 * `claimed: false` の場合は勝った側の実際の結果を `result` (Promise) で待てる契約に
 * 変更した。この単体テストでは claim/resolve の契約そのものを固定する。
 *
 * 注意 (App Developer 申し送り): claimedOAuthCodes はモジュールスコープの Map で
 * テスト間でリセットされない (プロダクションコードにテスト専用のリセット口は
 * 開けない方針)。同一 code 文字列を複数の it で使い回すと、既に他のテストが
 * 消費した状態が残り意図しない claimed:false が返るため、各テストケースで一意な
 * code 文字列を用いる。
 */
import { claimOAuthCode } from "../lib/google-auth";

describe("claimOAuthCode", () => {
  it("同一 code を2回渡すと1回目 claimed:true・2回目 claimed:false を返す", () => {
    const code = "claim-test-same-code-001";
    expect(claimOAuthCode(code)).toEqual({ claimed: true, resolve: expect.any(Function) });
    expect(claimOAuthCode(code)).toEqual({ claimed: false, result: expect.any(Promise) });
  });

  it("異なる code ならどちらも claimed:true を返す (それぞれ独立した OAuth コールバックとして扱われる)", () => {
    expect(claimOAuthCode("claim-test-diff-code-a").claimed).toBe(true);
    expect(claimOAuthCode("claim-test-diff-code-b").claimed).toBe(true);
  });

  it("同一 code への3回目以降の呼び出しも claimed:false のままである (消費済み状態が固定される)", () => {
    const code = "claim-test-same-code-002";
    expect(claimOAuthCode(code).claimed).toBe(true);
    expect(claimOAuthCode(code).claimed).toBe(false);
    expect(claimOAuthCode(code).claimed).toBe(false);
  });

  it("MAX_TRACKED_CODES (5件) を超えると最も古いものが追い出され、再度 claimed:true で claim できる", () => {
    const codes = [
      "claim-test-evict-1",
      "claim-test-evict-2",
      "claim-test-evict-3",
      "claim-test-evict-4",
      "claim-test-evict-5",
      "claim-test-evict-6",
    ];
    // 6件を連続で新規 claim する。新規 code なのでどれも claimed:true。
    for (const code of codes) {
      expect(claimOAuthCode(code).claimed).toBe(true);
    }
    // 6件目の push で保持数が5を超え、最も古い1件目 (evict-1) が追い出される
    // (この時点で他のテストからの残留エントリがあっても、6件連続で新規 push すれば
    // 直近5件だけが残る仕様のため、evict-1 の追い出しは確定的に発生する)。
    // 追い出された code は「未処理」扱いに戻るため、再度 claim すると claimed:true になる。
    expect(claimOAuthCode("claim-test-evict-1").claimed).toBe(true);

    // この再 claim 自体が新規 push のため、今度は evict-2 が追い出される。
    // 一方 evict-6 (直近に push されたもの) はまだ保持されているため claimed:false のまま。
    expect(claimOAuthCode("claim-test-evict-6").claimed).toBe(false);
  });

  it("勝った側が resolve({success:true}) すると、負けた側の result はそれを反映する", async () => {
    const code = "claim-test-resolve-success-001";
    const winner = claimOAuthCode(code);
    const loser = claimOAuthCode(code);
    if (!winner.claimed || loser.claimed) throw new Error("unexpected claim outcome");

    winner.resolve({ success: true });
    await expect(loser.result).resolves.toEqual({ success: true });
  });

  it("勝った側が resolve({success:false}) すると、負けた側の result はそれを反映する", async () => {
    const code = "claim-test-resolve-failure-001";
    const winner = claimOAuthCode(code);
    const loser = claimOAuthCode(code);
    if (!winner.claimed || loser.claimed) throw new Error("unexpected claim outcome");

    winner.resolve({ success: false });
    await expect(loser.result).resolves.toEqual({ success: false });
  });

  it("同一 code へ3人目以降が来ても、全員が同じ result を共有する", async () => {
    const code = "claim-test-resolve-shared-001";
    const winner = claimOAuthCode(code);
    const loserA = claimOAuthCode(code);
    const loserB = claimOAuthCode(code);
    if (!winner.claimed || loserA.claimed || loserB.claimed) {
      throw new Error("unexpected claim outcome");
    }

    winner.resolve({ success: true });
    await expect(loserA.result).resolves.toEqual({ success: true });
    await expect(loserB.result).resolves.toEqual({ success: true });
  });
});
