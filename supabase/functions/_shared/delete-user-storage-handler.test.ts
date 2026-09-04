// R2 削除経路のモック fetch テスト。
//
// このファイルがテストするのは `createDeleteUserStorageHandler()` が返す HTTP ハンドラの
// R2 経路 (getR2Config() が "ok" を返すケース) のみ。listAllR2Keys / deleteR2Keys /
// parseListObjectsV2Xml / cleanupR2 などは export されていないため直接 import できず、
// `globalThis.fetch` を差し替えて aws4fetch (AwsClient.fetch は内部で無修飾の `fetch(...)` を
// 1引数で呼ぶ) を横取りし、ハンドラ全体を通した振る舞いとして検証する。
//
// 実行方法:
//   cd swim-hub && npx deno test --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/delete-user-storage-handler.test.ts
//
// プロダクションコード (delete-user-storage-handler.ts) は一切変更していない。

import {
  assert,
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDeleteUserStorageHandler } from "./delete-user-storage-handler.ts";

// --- テスト共通ヘルパー ---

const SERVICE_ROLE_KEY = "test-service-role-key-for-qa-0000000000";

/** 各テストで固定的に必要な環境変数。R2_VIDEO_BUCKET_NAME はテストごとに明示制御する。 */
const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://example-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  R2_ACCOUNT_ID: "test-account-id",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
  R2_BUCKET_NAME: "test-image-bucket",
};

const DEFAULT_VIDEO_BUCKET = "swim-hub-videos-prod";

/**
 * 指定した環境変数を設定し、テスト終了時に元の値へ復元する関数を返す。
 * value === undefined のキーは明示的に削除する (未設定状態を再現するため)。
 */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = Deno.env.get(key);
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  };
}

interface RecordedCall {
  method: string;
  url: string;
}

/**
 * globalThis.fetch を差し替え、GET (ListObjectsV2) / DELETE それぞれに対する
 * レスポンスハンドラを呼び出す汎用モック。呼び出し履歴を calls に記録する。
 */
function installFetchMock(opts: {
  onList?: (url: URL) => Response | Promise<Response>;
  onDelete?: (url: URL) => Response | Promise<Response>;
}): { calls: RecordedCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: RecordedCall[] = [];

  globalThis.fetch = (async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push({ method: req.method, url: req.url });
    const url = new URL(req.url);

    if (req.method === "GET") {
      if (!opts.onList) {
        throw new Error(`Unexpected GET (list) request in this test: ${url.toString()}`);
      }
      return await opts.onList(url);
    }
    if (req.method === "DELETE") {
      if (!opts.onDelete) {
        throw new Error(`Unexpected DELETE request in this test: ${url.toString()}`);
      }
      return await opts.onDelete(url);
    }
    throw new Error(`Unexpected HTTP method in mock: ${req.method}`);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function buildListXml(
  keys: string[],
  opts: { truncated?: boolean; nextToken?: string } = {},
): string {
  const contents = keys.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join("");
  const truncatedTag = `<IsTruncated>${opts.truncated ? "true" : "false"}</IsTruncated>`;
  const tokenTag = opts.nextToken
    ? `<NextContinuationToken>${opts.nextToken}</NextContinuationToken>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>test</Name>${contents}${truncatedTag}${tokenTag}</ListBucketResult>`;
}

function emptyListResponse(): Response {
  return new Response(buildListXml([]), { status: 200 });
}

function deleteRequest(userId: string, token: string = SERVICE_ROLE_KEY): Request {
  return new Request("http://localhost/delete-user-storage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
  });
}

/** DELETE リクエストの URL から「バケット直下からのキーパス」をデコードして取り出す。 */
function decodedKeyFromDeleteUrl(url: URL, bucket: string): string {
  const marker = `/${bucket}/`;
  const idx = url.pathname.indexOf(marker);
  assert(idx !== -1, `DELETE url does not target bucket ${bucket}: ${url.pathname}`);
  const encodedKey = url.pathname.slice(idx + marker.length);
  return decodeURIComponent(encodedKey);
}

const ALL_PREFIXES = [
  { name: "profile-images", bucket: "test-image-bucket" },
  { name: "practice-images", bucket: "test-image-bucket" },
  { name: "competition-images", bucket: "test-image-bucket" },
  { name: "videos", bucket: DEFAULT_VIDEO_BUCKET },
  { name: "thumbnails", bucket: DEFAULT_VIDEO_BUCKET },
] as const;

// =====================================================================
// 1. prefix の境界安全性 (最優先)
// =====================================================================

Deno.test("1-1: 5プレフィックス全てで ListObjectsV2 の prefix が '{prefixName}/{userId}/' (末尾スラッシュあり) になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const seenPrefixesByBucket: Record<string, string[]> = {};

  const { calls, restore } = installFetchMock({
    onList: (url) => {
      const bucket = url.pathname.split("/")[1];
      const prefix = url.searchParams.get("prefix") ?? "";
      (seenPrefixesByBucket[bucket] ??= []).push(prefix);
      return emptyListResponse();
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body, { success: true });
    assertEquals(calls.length, 5, "5プレフィックス分の list リクエストが発行されること");

    for (const { name, bucket } of ALL_PREFIXES) {
      const prefixes = seenPrefixesByBucket[bucket] ?? [];
      assert(
        prefixes.includes(`${name}/userA/`),
        `bucket=${bucket} に対して prefix='${name}/userA/' が送信されていない (実際: ${
          JSON.stringify(prefixes)
        })`,
      );
    }
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("1-2: userId に他ユーザーのデコイフォルダと同名接頭辞を持つ文字列 (userA-decoy) が混入しても、prefix は userA 用の厳密な境界 (末尾スラッシュ) のまま送信される", async () => {
  // 別ラウンドの QA が Storage 側で `{userA}-decoy/` の生存を確認したシナリオの R2 版再現。
  // ここで検証すべきは「サーバーが何を返すか」ではなく「クライアントが送る prefix が
  // userA と userA-decoy を区別できる形になっているか」。
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const sentPrefixes: string[] = [];

  const { calls, restore } = installFetchMock({
    onList: (url) => {
      sentPrefixes.push(url.searchParams.get("prefix") ?? "");
      return emptyListResponse();
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    await handler(deleteRequest("userA"));

    assertEquals(calls.length, 5);
    for (const prefix of sentPrefixes) {
      assert(prefix.endsWith("/userA/"), `prefix が末尾スラッシュで終わっていない: ${prefix}`);
      assert(
        !prefix.includes("userA-decoy"),
        `prefix に他ユーザーのデコイ文字列が混入している: ${prefix}`,
      );
    }
    // "profile-images/userA/" は "profile-images/userA-decoy/" の前方一致にはなるが、
    // S3 互換 ListObjectsV2 の prefix マッチングはリテラル前方一致であり、
    // "userA/" の末尾スラッシュにより "userA-decoy/..." のキーはそもそも一致しない
    // (これはサーバー側 S3 実装の契約であり、クライアント側は正しい prefix を送る
    // ことでのみこの安全性を担保できる)。
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("1-3: ListObjectsV2 が prefix と無関係なキー (デコイ) を混入させて返しても、クライアント側ガードにより該当キーは DELETE されず、prefix配下の正常なキーは引き続き削除され success:true のままになる", async () => {
  // サーバー (S3互換ListObjectsV2) が契約に反して prefix と無関係なキーを返す
  // (実装ミス・互換レイヤーのバグ・中間プロキシの改竄等) 障害を模擬し、
  // cleanupR2 の `key.startsWith(prefix)` ガードが実際に機能することを検証する。
  //
  // 2点を同時に確認する:
  //   (a) デコイキーが DELETE されないこと (過検出ではなく正しく弾けているか)
  //   (b) 同じ応答に含まれる prefix 配下の正常なキーは引き続き削除されること
  //       (ガードが「疑わしきは全部弾く」という過剰防御になっていないか。
  //        ここを確認しないと「全部弾いて名目上は安全、実質は削除機能停止」を見逃す)
  //   (c) 弾いたことにより success:false / errors には積まれないこと (退会処理自体を
  //       ブロックしない設計であることの固定)
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const decoyKey = "videos/userA-decoy/x.mp4";
  const legitimateKey = "videos/userA/real.mp4";
  const deletedPaths: string[] = [];

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") === "videos/userA/") {
        // 本来 S3 はこの prefix でデコイキーを返さないはずだが、
        // 「サーバーが誤って/悪意を持って返した」場合を模擬する。
        // 同時に prefix 配下の正常なキーも混ぜ、ガードの選別能力を確認する。
        return new Response(buildListXml([decoyKey, legitimateKey]), { status: 200 });
      }
      return emptyListResponse();
    },
    onDelete: (url) => {
      deletedPaths.push(url.pathname);
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assert(
      !deletedPaths.some((p) => p.includes("userA-decoy")),
      `ガードが機能せずデコイキーが DELETE されてしまった: ${JSON.stringify(deletedPaths)}`,
    );
    assert(
      deletedPaths.some((p) => p.includes("real.mp4")),
      `ガードが過検出になっており、prefix 配下の正常なキーまで削除されなかった: ${
        JSON.stringify(deletedPaths)
      }`,
    );
    // デコイを弾いたことは「サーバー契約違反の自衛」であり、このリクエスト自体の
    // 失敗ではない。errors に積まれず success:true のままであることを固定する。
    assertEquals(res.status, 200);
    assertEquals(body, { success: true });
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 2. ページネーション
// =====================================================================

Deno.test("2-1: IsTruncated + NextContinuationToken を跨いだ全ページのキーが漏れなく DELETE され、2ページ目以降の URL に continuation-token が正しく載る", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "profile-images/userA/";
  const bucket = "test-image-bucket";

  const page1Keys = ["profile-images/userA/a.jpg", "profile-images/userA/b.jpg"];
  const page2Keys = ["profile-images/userA/c.jpg", "profile-images/userA/d.jpg"];
  const page3Keys = ["profile-images/userA/e.jpg"];

  let listCallCountForTarget = 0;
  const continuationTokensSeen: (string | null)[] = [];
  const deletedKeys: string[] = [];

  const { restore } = installFetchMock({
    onList: (url) => {
      const prefix = url.searchParams.get("prefix");
      if (prefix !== targetPrefix) return emptyListResponse();

      listCallCountForTarget += 1;
      continuationTokensSeen.push(url.searchParams.get("continuation-token"));

      if (listCallCountForTarget === 1) {
        return new Response(
          buildListXml(page1Keys, { truncated: true, nextToken: "token-page-2" }),
          { status: 200 },
        );
      }
      if (listCallCountForTarget === 2) {
        return new Response(
          buildListXml(page2Keys, { truncated: true, nextToken: "token-page-3" }),
          { status: 200 },
        );
      }
      if (listCallCountForTarget === 3) {
        return new Response(buildListXml(page3Keys, { truncated: false }), { status: 200 });
      }
      throw new Error("4回目以降の list 呼び出しは発生してはならない (ループが止まっていない)");
    },
    onDelete: (url) => {
      deletedKeys.push(decodedKeyFromDeleteUrl(url, bucket));
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body, { success: true });
    assertEquals(listCallCountForTarget, 3, "3ページ分の list リクエストで完結すること");
    assertEquals(
      continuationTokensSeen,
      [null, "token-page-2", "token-page-3"],
      "1ページ目は continuation-token 無し、2/3ページ目は前ページの token が正しく引き継がれること",
    );

    const allExpectedKeys = [...page1Keys, ...page2Keys, ...page3Keys].sort();
    assertEquals(
      deletedKeys.sort(),
      allExpectedKeys,
      "全ページのキーが漏れなく (重複・欠落なく) DELETE 対象になること",
    );
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("2-2: IsTruncated=false の初回応答でループが1回で止まること", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "videos/userA/";
  let listCallCount = 0;

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      listCallCount += 1;
      return new Response(
        buildListXml(["videos/userA/only.mp4"], { truncated: false }),
        { status: 200 },
      );
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    assertEquals(res.status, 200);
    assertEquals(listCallCount, 1);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("2-3: R2 が同じ NextContinuationToken を返し続けても無限ループにならず、fail-closed になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  // R2/中間層の不具合で同一トークンが返り続けると、トークンの重複を検知しない限り
  // do...while は永久に回り続け Edge Function が応答不能になる。7-5 (token 欠落) とは
  // 別経路の無限ループであり、こちらは「トークンはあるが前進しない」ケース。
  const repeatedTokenXml = buildListXml(["practice-images/userA/a.jpg"], {
    truncated: true,
    nextToken: "stuck-token",
  });

  let listCallCount = 0;
  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      listCallCount += 1;
      if (listCallCount > 5) {
        // 無限ループに陥っていないことの安全弁 (7-5 と同じ理由)。
        throw new Error("list が5回を超えて呼ばれた。無限ループの疑いがある");
      }
      return new Response(repeatedTokenXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    // 1回目でトークンを記録し、2回目で重複を検知して中断するため list は2回で止まる。
    assertEquals(listCallCount, 2, "重複トークンは2回目の list で検知して中断すること");
    assertEquals(res.status, 500);
    assertFailClosed(body, "2-3 (NextContinuationToken が前進しない)");
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 3. XML パーサー (正規表現ベース)
// =====================================================================

Deno.test("3-1: 名前付き XML エンティティ (&amp; &lt; &gt; &quot; &apos;) を含むキーが正しくデコードされて DELETE される", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const bucket = "test-image-bucket";
  const targetPrefix = "profile-images/userA/";

  // (XMLとして書いた場合の生の中身, 期待されるデコード後の文字列)
  const cases: [string, string][] = [
    ["profile-images/userA/a&amp;b.jpg", "profile-images/userA/a&b.jpg"],
    ["profile-images/userA/&lt;tag&gt;.jpg", "profile-images/userA/<tag>.jpg"],
    ["profile-images/userA/say&quot;hi&quot;.jpg", 'profile-images/userA/say"hi".jpg'],
    ["profile-images/userA/it&apos;s.jpg", "profile-images/userA/it's.jpg"],
  ];

  const deletedKeys: string[] = [];
  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(buildListXml(cases.map((c) => c[0])), { status: 200 });
    },
    onDelete: (url) => {
      deletedKeys.push(decodedKeyFromDeleteUrl(url, bucket));
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    assertEquals(res.status, 200);

    for (const [, expectedDecoded] of cases) {
      assert(
        deletedKeys.includes(expectedDecoded),
        `期待したデコード結果 '${expectedDecoded}' が DELETE キー一覧に無い (実際: ${
          JSON.stringify(deletedKeys)
        })`,
      );
    }
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("3-2: 数値文字参照 (10進 &#39; / 16進 &#x27; の両形式) が正しくデコードされる", async () => {
  // 修正前は decodeXmlEntities が名前付きエンティティ (&amp; &lt; &gt; &quot; &apos;) のみに
  // 対応しており、数値文字参照 (&#NN; / &#xHH;) はデコードされず文字列としてそのまま
  // 残っていた (Warning 1 として報告、Developer が両形式対応で修正済み)。
  // Sprint Contract が &#39; を明示的にケースとして要求しているため、10進・16進の
  // 両方の表記でアポストロフィが正しく復元されることを検証する。
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const bucket = "test-image-bucket";
  const targetPrefix = "profile-images/userA/";
  const decKeyInXml = "profile-images/userA/it&#39;s-dec.jpg"; // 10進形式
  const hexKeyInXml = "profile-images/userA/it&#x27;s-hex.jpg"; // 16進形式

  const deletedKeys: string[] = [];
  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(buildListXml([decKeyInXml, hexKeyInXml]), { status: 200 });
    },
    onDelete: (url) => {
      deletedKeys.push(decodedKeyFromDeleteUrl(url, bucket));
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    await handler(deleteRequest("userA"));

    assert(
      deletedKeys.includes("profile-images/userA/it's-dec.jpg"),
      `10進数値文字参照 &#39; が正しくデコードされなかった。DELETE されたキー: ${
        JSON.stringify(deletedKeys)
      }`,
    );
    assert(
      deletedKeys.includes("profile-images/userA/it's-hex.jpg"),
      `16進数値文字参照 &#x27; が正しくデコードされなかった。DELETE されたキー: ${
        JSON.stringify(deletedKeys)
      }`,
    );
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("3-3: 日本語・スペース・+・% を含むキー名が正しく round-trip する", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const bucket = "test-image-bucket";
  const targetPrefix = "practice-images/userA/";
  const key = "practice-images/userA/日本語 ファイル+100%テスト.jpg";

  const deletedKeys: string[] = [];
  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(buildListXml([key]), { status: 200 });
    },
    onDelete: (url) => {
      deletedKeys.push(decodedKeyFromDeleteUrl(url, bucket));
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    assertEquals(res.status, 200);
    assert(
      deletedKeys.includes(key),
      `日本語/スペース/+/% を含むキーが正しく round-trip しない: ${JSON.stringify(deletedKeys)}`,
    );
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("3-4: <Contents> が0件のレスポンスは success:true・DELETE 呼び出し0件で正常終了する", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  let deleteCallCount = 0;

  const { restore } = installFetchMock({
    onList: () => emptyListResponse(),
    onDelete: () => {
      deleteCallCount += 1;
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 200);
    assertEquals(body, { success: true });
    assertEquals(deleteCallCount, 0);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("3-5: 200 OK だが本文が空文字列 (壊れたレスポンス) の場合、fail-closed で success:false・errors 非空になる (サイレント成功が修正されたことの固定)", async () => {
  // 修正前は parseListObjectsV2Xml が正規表現マッチのみで XML として妥当かどうかを
  // 一切検証していなかった。<Key> にマッチしなければ keys=[]、<IsTruncated>true</IsTruncated>
  // にマッチしなければ isTruncated=false になるため、ステータスが 200 である限り
  // 「本文が空文字列」であっても例外を投げず「このプレフィックスは0件だった」という
  // 扱いになっていた (Sprint Contract が明示的に禁止した「無言で空配列を返して
  // 『消すものが無かった』と誤認する」フェイルモード、Critical として報告)。
  // Developer が <ListBucketResult> ルート要素の有無を検査する修正を入れたため、
  // 現在は例外が投げられ fail-closed (success:false) になることを固定する。
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "competition-images/userA/";
  let deleteCallCount = 0;

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      // 200 OK だが空文字列 (ネットワーク障害でボディが欠落した/読み込み途中で
      // 切れた等を模擬)。妥当な ListBucketResult ではない。
      return new Response("", { status: 200 });
    },
    onDelete: () => {
      deleteCallCount += 1;
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(
      Array.isArray(body.errors) && body.errors.length > 0,
      `空/壊れたXML応答がエラーとして扱われていない: status=${res.status} body=${
        JSON.stringify(body)
      } deleteCallCount=${deleteCallCount}`,
    );
    assert(
      body.errors.some((e: string) => e.includes("competition-images")),
      `errors に該当プレフィックスへの言及が無い: ${JSON.stringify(body.errors)}`,
    );
    assertEquals(deleteCallCount, 0, "エラー検出前に DELETE が発行されてはならない");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("3-6: 完全に壊れた非XML文字列 (プレーンテキスト) でもハンドラ自体はクラッシュせず、同じくfail-closed (success:false) として扱われる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "videos/userA/";
  let handlerThrew = false;

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response("<html><body>502 Bad Gateway</body></html>", { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    let res: Response;
    try {
      res = await handler(deleteRequest("userA"));
    } catch {
      handlerThrew = true;
      res = new Response(null, { status: 599 });
    }
    // クラッシュ (未捕捉例外によるハンドラ関数自体の throw) はしない、という事実を確認する。
    // これは handler 全体が try/catch で包まれているため。
    assertStrictEquals(handlerThrew, false);
    // 3-5と同じ理由 (<ListBucketResult> 不在) でエラー検出され、fail-closed になる。
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.success, false);
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 4. list 失敗が fail-closed になること
// =====================================================================

Deno.test("4-1: ListObjectsV2 が 404 (NoSuchBucket) を返すと success:false・errors に積まれ、HTTPステータス500になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "profile-images/userA/";
  let deleteCallCount = 0;

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(
        `<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>bucket not found</Message></Error>`,
        { status: 404 },
      );
    },
    onDelete: () => {
      deleteCallCount += 1;
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(Array.isArray(body.errors) && body.errors.length > 0, "errors配列が空であってはならない");
    assert(
      body.errors.some((e: string) => e.includes("profile-images")),
      `errors に失敗した prefix (profile-images) への言及が無い: ${JSON.stringify(body.errors)}`,
    );
    assertEquals(deleteCallCount, 0, "list に失敗したプレフィックスでは DELETE が呼ばれないこと");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("4-2: ListObjectsV2 が 403 (Forbidden) を返しても同様に fail-closed (success:false) になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "videos/userA/";

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(
        `<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>`,
        { status: 403 },
      );
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(body.errors.some((e: string) => e.includes("videos")));
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("4-3: 一部プレフィックスのみ list 失敗した場合でも他プレフィックスの正常な削除は継続し、最終的に success:false・全エラーが集約される", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const failingPrefix = "thumbnails/userA/";
  const okPrefix = "profile-images/userA/";
  const deletedKeys: string[] = [];

  const { restore } = installFetchMock({
    onList: (url) => {
      const prefix = url.searchParams.get("prefix");
      if (prefix === failingPrefix) {
        return new Response("server error", { status: 404 });
      }
      if (prefix === okPrefix) {
        return new Response(buildListXml(["profile-images/userA/ok.jpg"]), { status: 200 });
      }
      return emptyListResponse();
    },
    onDelete: (url) => {
      deletedKeys.push(url.pathname);
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(body.errors.some((e: string) => e.includes("thumbnails")));
    assert(
      deletedKeys.some((p) => p.includes("ok.jpg")),
      "失敗していない他プレフィックスの削除は実行されること",
    );
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 5. 設定不備の扱い
// =====================================================================

Deno.test("5-1: R2認証情報はあるが R2_BUCKET_NAME が未設定のとき、明示的にエラー (success:false, 500) になり、一切 fetch されない", async () => {
  const restoreEnv = withEnv({
    ...BASE_ENV,
    R2_BUCKET_NAME: undefined,
    R2_VIDEO_BUCKET_NAME: undefined,
  });
  const { calls, restore } = installFetchMock({});

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(
      body.errors.some((e: string) => e.includes("R2_BUCKET_NAME")),
      `errors に R2_BUCKET_NAME への言及が無い: ${JSON.stringify(body.errors)}`,
    );
    assertEquals(calls.length, 0, "設定不備は list/delete 呼び出し前に検出されること");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("5-1b: R2認証情報が3つ中1つだけ欠落しているとき、Storageフォールバックに倒れず明示的にエラー (success:false, 500) になり、一切 fetch されない", async () => {
  const restoreEnv = withEnv({
    ...BASE_ENV,
    R2_ACCESS_KEY_ID: undefined,
    R2_VIDEO_BUCKET_NAME: undefined,
  });
  const { calls, restore } = installFetchMock({});

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(
      body.errors.some((e: string) => e.includes("R2_ACCESS_KEY_ID")),
      `errors に R2_ACCESS_KEY_ID への言及が無い: ${JSON.stringify(body.errors)}`,
    );
    assertEquals(calls.length, 0, "設定不備は list/delete 呼び出し前に検出されること");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("5-2: R2_VIDEO_BUCKET_NAME 未設定時は既定値 swim-hub-videos-prod にフォールバックする", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const seenBucketsForVideoPrefixes = new Set<string>();

  const { restore } = installFetchMock({
    onList: (url) => {
      const prefix = url.searchParams.get("prefix") ?? "";
      if (prefix.startsWith("videos/") || prefix.startsWith("thumbnails/")) {
        seenBucketsForVideoPrefixes.add(url.pathname.split("/")[1]);
      }
      return emptyListResponse();
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    assertEquals(res.status, 200);
    assertEquals(
      [...seenBucketsForVideoPrefixes],
      [DEFAULT_VIDEO_BUCKET],
      "videos/thumbnails プレフィックスは既定の動画バケット名に落ちること",
    );
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("5-3: R2_VIDEO_BUCKET_NAME を明示設定した場合はそちらが優先される", async () => {
  const customVideoBucket = "custom-video-bucket-for-test";
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: customVideoBucket });
  const seenBucketsForVideoPrefixes = new Set<string>();

  const { restore } = installFetchMock({
    onList: (url) => {
      const prefix = url.searchParams.get("prefix") ?? "";
      if (prefix.startsWith("videos/") || prefix.startsWith("thumbnails/")) {
        seenBucketsForVideoPrefixes.add(url.pathname.split("/")[1]);
      }
      return emptyListResponse();
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    await handler(deleteRequest("userA"));
    assertEquals([...seenBucketsForVideoPrefixes], [customVideoBucket]);
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 6. 同時実行数の制限 (R2_DELETE_CONCURRENCY = 20)
// =====================================================================

Deno.test("6-1: 100件のキーを削除する際、同時に走る DELETE fetch が 20 を超えず、かつ全件が漏れなく DELETE される", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const bucket = DEFAULT_VIDEO_BUCKET;
  const targetPrefix = "videos/userA/";
  const totalKeys = 100;
  const keys = Array.from(
    { length: totalKeys },
    (_, i) => `videos/userA/file-${String(i).padStart(3, "0")}.mp4`,
  );

  let inFlight = 0;
  let maxInFlight = 0;
  const deletedKeys = new Set<string>();

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(buildListXml(keys), { status: 200 });
    },
    onDelete: async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // 並列度が実際に積み上がる時間を作るための人為的な遅延。
      await new Promise((resolve) => setTimeout(resolve, 5));
      deletedKeys.add(decodedKeyFromDeleteUrl(url, bucket));
      inFlight -= 1;
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body, { success: true });
    assert(
      maxInFlight <= 20,
      `同時実行数が上限20を超えた: maxInFlight=${maxInFlight}`,
    );
    assert(maxInFlight >= 2, "並列実行になっていることの最低限のサニティチェック (直列化していないか)");
    assertEquals(deletedKeys.size, totalKeys, "全100件が漏れなくDELETEされること");
    for (const k of keys) {
      assert(deletedKeys.has(k), `キー ${k} が削除されなかった`);
    }
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("6-2: 削除対象キーが0件のプレフィックスでは DELETE リクエストが1件も発生しない", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  let deleteCallCount = 0;

  const { restore } = installFetchMock({
    onList: () => emptyListResponse(),
    onDelete: () => {
      deleteCallCount += 1;
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    assertEquals(res.status, 200);
    assertEquals(deleteCallCount, 0);
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("6-3: 一部のDELETEが失敗 (非2xx) すると success:false になり、失敗件数が反映される", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "thumbnails/userA/";
  const keys = ["thumbnails/userA/a.jpg", "thumbnails/userA/b.jpg", "thumbnails/userA/c.jpg"];

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(buildListXml(keys), { status: 200 });
    },
    onDelete: (url) => {
      // "b.jpg" のみ削除失敗させる。
      if (url.pathname.includes("b.jpg")) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(null, { status: 204 });
    },
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assertEquals(res.status, 500);
    assertEquals(body.success, false);
    assert(
      body.errors.some((e: string) => e.includes("thumbnails") && e.includes("1/3")),
      `errors に失敗件数 (1/3) の言及が無い: ${JSON.stringify(body.errors)}`,
    );
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 7. 切断・矛盾した XML 応答の回帰テスト (Reviewer 発見の Critical)
// =====================================================================
//
// 3-5/3-6 は「本文が完全に空/完全に非XML」というケースのみをカバーしており、
// 「開始タグ (<ListBucketResult>) はあるが応答が途中で切断されている」ケースが
// 抜けていた。この場合 <ListBucketResult\b の存在チェックは通過してしまい、
// 未完了の <Key> は (正規表現ベースの実装では) 単純に無視され、<IsTruncated> が
// 無ければページネーションも false 扱いで打ち切られる。結果、"一部のキーだけが
// 正しく削除され success:true として報告される" という、完全な空応答より発見しにくい
// 失敗モードになる (部分削除なのに全体としては成功と誤認される)。
//
// 重要: Developer が正規表現パースを実 XML パーサーに置き換える可能性があるため、
// ここでは「実装がどう壊れているか」ではなく「壊れた入力に対してハンドラ全体が
// fail-closed (success:false, errors 非空) になるか」という観測可能な振る舞いのみを
// assert する。DELETE が何件発行されたか・どのキーが削除されたかという内部詳細には
// 依存しない (パース方式が変わっても意味を保つため)。

function assertFailClosed(body: { success: boolean; errors?: string[] }, context: string): void {
  assert(
    body.success === false && Array.isArray(body.errors) && body.errors.length > 0,
    `${context}: 壊れた/矛盾した XML 応答が fail-closed (success:false, errors非空) になっていない。` +
      `実際: ${JSON.stringify(body)}`,
  );
}

Deno.test("7-1: <Contents> の途中で切断されたレスポンスは、一部キーが正しくパースできても全体としては fail-closed になる (部分削除で成功と報告しない)", async () => {
  // Reviewer が実測した再現ケース: 1件目の <Contents> は完結しているが、
  // 2件目の <Key> が閉じタグの手前で切断されている。
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  const truncatedXml =
    `<?xml version="1.0"?><ListBucketResult><Name>test</Name>` +
    `<Contents><Key>practice-images/userA/a.jpg</Key><Size>1</Size></Contents>` +
    `<Contents><Key>practice-images/userA/b.jpg`; // ここで切断 (Reviewer 実測どおり)

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(truncatedXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertFailClosed(body, "7-1 (<Contents>途中切断)");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("7-2: <Key> の途中で切断されたレスポンス (閉じタグが存在しない) は fail-closed になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  const truncatedKeyXml =
    `<?xml version="1.0"?><ListBucketResult><Name>test</Name>` +
    `<Contents><Key>practice-images/userA/b`; // </Key> が無い

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(truncatedKeyXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertFailClosed(body, "7-2 (<Key>途中切断)");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("7-3: </ListBucketResult> の閉じタグが無いレスポンスは fail-closed になる", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  // <Contents> 自体は完結しているが、ドキュメント全体としては閉じられていない
  // (通信が最後まで届いていない可能性を示す壊れたレスポンス)。
  const noClosingRootTagXml =
    `<?xml version="1.0"?><ListBucketResult><Name>test</Name>` +
    `<Contents><Key>practice-images/userA/a.jpg</Key><Size>1</Size></Contents>` +
    `<IsTruncated>false</IsTruncated>`; // </ListBucketResult> が無い

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(noClosingRootTagXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertFailClosed(body, "7-3 (</ListBucketResult>欠落)");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("7-4: <IsTruncated> タグ自体が存在しないレスポンスは fail-closed になる (正常な応答は真偽どちらであれ必ず含む)", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  // <Contents> は完結しているが <IsTruncated> が丸ごと欠落している。
  // 正常な ListObjectsV2 応答は true/false いずれであっても必ず <IsTruncated> を
  // 含むため、これが無いこと自体が「応答が不完全である」強いシグナルになる。
  const missingIsTruncatedXml =
    `<?xml version="1.0"?><ListBucketResult><Name>test</Name>` +
    `<Contents><Key>practice-images/userA/a.jpg</Key><Size>1</Size></Contents>` +
    `</ListBucketResult>`;

  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      return new Response(missingIsTruncatedXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();
    assertEquals(res.status, 500);
    assertFailClosed(body, "7-4 (<IsTruncated>欠落)");
  } finally {
    restore();
    restoreEnv();
  }
});

Deno.test("7-5: IsTruncated=true なのに NextContinuationToken が無い矛盾したレスポンスは、無限ループにならず、かつ fail-closed になる (取得できた分だけで成功と報告しない)", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const targetPrefix = "practice-images/userA/";
  // IsTruncated=true (=まだ続きがある) にもかかわらず、続きを取得するための
  // NextContinuationToken が無い。「取得できた分だけで打ち切って成功扱いにする」
  // ことは、本来もっと多くのキーが存在するのに一部だけ削除して成功報告する
  // 危険な部分削除になるため許容できない。
  const truncatedButNoTokenXml =
    `<?xml version="1.0"?><ListBucketResult><Name>test</Name>` +
    `<Contents><Key>practice-images/userA/a.jpg</Key><Size>1</Size></Contents>` +
    `<IsTruncated>true</IsTruncated></ListBucketResult>`;

  let listCallCount = 0;
  const { restore } = installFetchMock({
    onList: (url) => {
      if (url.searchParams.get("prefix") !== targetPrefix) return emptyListResponse();
      listCallCount += 1;
      if (listCallCount > 5) {
        // 無限ループに陥っていないことの安全弁。5回を超えて呼ばれたら即座に
        // テストを失敗させる (タイムアウトで曖昧に落ちるのを避ける)。
        throw new Error("list が5回を超えて呼ばれた。無限ループの疑いがある");
      }
      return new Response(truncatedButNoTokenXml, { status: 200 });
    },
    onDelete: () => new Response(null, { status: 204 }),
  });

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA"));
    const body = await res.json();

    assert(listCallCount <= 5, `list 呼び出しが異常に多い (無限/長時間ループの疑い): ${listCallCount}回`);
    assertEquals(res.status, 500);
    assertFailClosed(body, "7-5 (IsTruncated=trueなのにtoken欠落)");
  } finally {
    restore();
    restoreEnv();
  }
});

// =====================================================================
// 補助: 認証まわりの回帰確認 (R2 経路に入る前提条件なので簡単に確認する)
// =====================================================================

Deno.test("補助: Authorization ヘッダーが不一致だと 401 になり、fetch は一切発生しない", async () => {
  const restoreEnv = withEnv({ ...BASE_ENV, R2_VIDEO_BUCKET_NAME: undefined });
  const { calls, restore } = installFetchMock({});

  try {
    const handler = createDeleteUserStorageHandler();
    const res = await handler(deleteRequest("userA", "wrong-token"));
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  } finally {
    restore();
    restoreEnv();
  }
});
