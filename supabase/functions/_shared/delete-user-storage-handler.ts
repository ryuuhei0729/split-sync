import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";
// 正規表現ベースの逐次パースでは「マッチしない (0件)」と「壊れている/切断された」を
// 構造的に区別できず、サイレント成功の欠陥が複数回見つかった (getR2Config の設定不備、
// 空レスポンス、途中で切断されたレスポンス)。整形式検証を行う実XMLパーサーに置き換える
// ことでこの欠陥クラス自体を排除する。WASM 依存の無い純TypeScript実装 (deno.land/x/xml)
// を選定した (jsr:@libs/xml の最新版は内部で WASM パーサーを使っており、Edge Function の
// サンドボックス環境での WASM 初期化という新たな失敗要因を持ち込みたくなかったため)。
// エンティティのデコード (名前付き・数値文字参照とも) もパーサーが1回のパスで正しく
// 処理するため、逐次 .replace() による二重デコードの問題も同時に解消される。
import { parse as parseXml } from "https://deno.land/x/xml@2.1.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// R2 に保存される画像バケット側のプレフィックス (Supabase Storage フォールバックの
// バケット名とも一致する)
const IMAGE_STORAGE_PREFIXES = ["profile-images", "practice-images", "competition-images"] as const;

// R2 動画バケット側のプレフィックス。Supabase Storage には動画用バケットが存在しない
// (R2 無効時は動画アップロード自体が 503 になる) ため、フォールバック対象外。
const VIDEO_STORAGE_PREFIXES = ["videos", "thumbnails"] as const;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Auth ---
// stripe-webhook / revenucat-webhook と同じ「事前共有シークレットとの完全一致」パターン。
// verify_jwt はプラットフォーム設定で無効化し (config.toml)、ここでのチェックのみに一本化する。
// このEdge Functionは service_role (アプリのサーバー側 API Route) からのみ呼ばれる想定であり、
// verify_jwt=true にしても「署名として正しい任意の JWT」を許してしまい service_role 限定に
// ならないため、SUPABASE_SERVICE_ROLE_KEY との厳密一致チェックで代替する。
function verifyServiceRoleAuth(req: Request, expectedServiceRoleKey: string): boolean {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.substring(7);
  const expected = expectedServiceRoleKey;
  if (token.length !== expected.length) return false;

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(expected);
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// --- R2 (aws4fetch 経由の S3 互換 API) ---
// Deno ランタイムには Cloudflare Workers の R2 バインディングが存在しないため、
// list / delete ともに aws4fetch で S3 互換 API を直接叩く。
// ListObjectsV2 のページネーション (ContinuationToken) 処理を含む、この Edge Function
// 専用の実装。Next.js アプリ側とはデプロイ境界が異なり import できないため独立実装している。

function encodeR2Key(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * ListObjectsV2 の XML レスポンスをパースする。
 *
 * parseXml() は整形式検証を行う実XMLパーサーであり、閉じタグの不一致・末尾切断等の
 * 壊れた入力は例外を投げる (正規表現の逐次マッチでは「マッチしない」と「壊れている」を
 * 区別できず、切断されたレスポンスの後半だけが黙って無視される問題があった)。
 * ただし「XMLとしては整形式だが ListBucketResult ではない」(空文字列→{}、無関係な
 * XML等) はパーサー自身はエラーにしないため、ルート要素の存在は別途明示的に検証する。
 * さらに <IsTruncated> の存在自体も必須にする (安価な追加防御: 正常な ListObjectsV2
 * 応答は真偽どちらであれ必ずこのタグを含むため、欠落は仕様外レスポンスの兆候とみなす)。
 */
function parseListObjectsV2Xml(xml: string): {
  keys: string[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
} {
  let parsed: unknown;
  try {
    parsed = parseXml(xml);
  } catch (err) {
    throw new Error(
      `Unexpected ListObjectsV2 response: XML parse failed (bodyLength=${xml.length}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const root = (parsed as Record<string, unknown> | null)?.ListBucketResult;
  if (!root || typeof root !== "object") {
    throw new Error(
      `Unexpected ListObjectsV2 response: missing <ListBucketResult> root element (bodyLength=${xml.length})`,
    );
  }
  const resultObj = root as Record<string, unknown>;

  if (!("IsTruncated" in resultObj)) {
    throw new Error(
      `Unexpected ListObjectsV2 response: missing <IsTruncated> element (bodyLength=${xml.length})`,
    );
  }

  // <Contents> は0件なら省略、1件なら単一オブジェクト、複数件なら配列になる
  // (このXMLパーサーの仕様) ため、配列に正規化する。
  const rawContents = resultObj.Contents;
  const contentsArray = Array.isArray(rawContents)
    ? rawContents
    : rawContents !== undefined && rawContents !== null
      ? [rawContents]
      : [];

  const keys = contentsArray
    .map((entry) => (entry as Record<string, unknown> | null)?.Key)
    .filter((key): key is string | number => key !== undefined && key !== null)
    .map((key) => String(key));

  const isTruncatedRaw = resultObj.IsTruncated;
  const isTruncated =
    isTruncatedRaw === true ||
    (typeof isTruncatedRaw === "string" && isTruncatedRaw.toLowerCase() === "true");

  const tokenRaw = resultObj.NextContinuationToken;
  const nextContinuationToken =
    tokenRaw !== undefined && tokenRaw !== null && tokenRaw !== "" ? String(tokenRaw) : null;

  // 矛盾したレスポンスの検出: IsTruncated=true (=まだ続きがある) にもかかわらず
  // NextContinuationToken が無いと、ページネーションのループは「これ以上取得できない」
  // と判断して静かに終了してしまう。これは「取得できた分だけで打ち切って成功扱いにする」
  // 危険な部分削除 (本来もっと多くのキーが存在するのに一部だけ削除して成功報告する) に
  // つながるため、正常系として扱わず例外を投げて fail-closed させる。
  if (isTruncated && !nextContinuationToken) {
    throw new Error(
      `Unexpected ListObjectsV2 response: IsTruncated=true but NextContinuationToken is missing (bodyLength=${xml.length})`,
    );
  }

  return { keys, isTruncated, nextContinuationToken };
}

// R2 への単一リクエストのタイムアウト。呼び出し元 (apps/web の delete route) が
// 最大3回リトライするため、タイムアウトが無いと1回の接続滞留が退会処理全体を
// 3倍の時間ブロックし得る。stalled connection を検知して打ち切るための保守的な値。
const R2_FETCH_TIMEOUT_MS = 30_000;

/**
 * 指定バケット・プレフィックス配下のオブジェクトキーを全件取得する (ページネーション対応)。
 * ListObjectsV2 は1回の応答で最大1000件までしか返さないため、IsTruncated=true の間
 * ContinuationToken を辿って全ページ取得しないと、1000件を超えるオブジェクトが
 * 削除対象から漏れる (孤児オブジェクトの発生源になる)。
 */
async function listAllR2Keys(
  aws: AwsClient,
  endpoint: string,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const allKeys: string[] = [];
  let continuationToken: string | null = null;
  const seenContinuationTokens = new Set<string>();

  do {
    const url = new URL(`${endpoint}/${bucket}`);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (continuationToken) {
      url.searchParams.set("continuation-token", continuationToken);
    }

    const res = await aws.fetch(url.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(R2_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`R2 ListObjectsV2 failed (${bucket}): ${res.status} ${body.slice(0, 200)}`);
    }

    const xml = await res.text();
    const { keys, isTruncated, nextContinuationToken } = parseListObjectsV2Xml(xml);
    allKeys.push(...keys);
    continuationToken = isTruncated ? nextContinuationToken : null;

    // R2/中間層が同じ continuation token を繰り返し返すと do...while が終了せず
    // Edge Function が応答不能になる。既出トークンを検出したら fail-closed で中断する。
    if (continuationToken) {
      if (seenContinuationTokens.has(continuationToken)) {
        throw new Error(
          `R2 ListObjectsV2 returned a repeated continuation token for bucket ${bucket} (prefix=${prefix})`,
        );
      }
      seenContinuationTokens.add(continuationToken);
    }
  } while (continuationToken);

  return allKeys;
}

// R2 への同時 DELETE リクエスト数の上限。
// 数年分のチーム活動を持つユーザーは画像・動画あわせて数千オブジェクトに達し得る。
// 無制限並列だと R2 の同時接続数/レート制限に当たって部分的に失敗し、リトライしても
// 同じ理由で3回とも失敗するため、fail-closed 設計のもとでは退会そのものが永久に
// ブロックされてしまう。20 並列であれば数千件規模でも実用時間内に完了しつつ、
// 瞬間的な負荷を抑えて安定して完走できるレベルとして採用した (経験的な安全値。
// R2 は本来もっと高いスループットを捌けるが、Edge Function 単一プロセスからの
// 同時 fetch 数はコネクションプール・タイムアウトの制約を受けやすいため保守的に倒す)。
const R2_DELETE_CONCURRENCY = 20;

async function deleteR2Keys(
  aws: AwsClient,
  endpoint: string,
  bucket: string,
  keys: string[],
): Promise<void> {
  const failedKeys: string[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex++;
      if (index >= keys.length) return;

      const key = keys[index];
      try {
        const res = await aws.fetch(`${endpoint}/${bucket}/${encodeR2Key(key)}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(R2_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) failedKeys.push(key);
      } catch {
        failedKeys.push(key);
      }
    }
  }

  const workerCount = Math.min(R2_DELETE_CONCURRENCY, keys.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failedKeys.length > 0) {
    throw new Error(`R2 delete failed for ${failedKeys.length}/${keys.length} keys in bucket ${bucket}`);
  }
}

interface R2Config {
  aws: AwsClient;
  endpoint: string;
  imageBucket: string;
  videoBucket: string;
}

type R2ConfigResult =
  | { status: "not-configured" }
  | { status: "misconfigured"; reason: string }
  | { status: "ok"; config: R2Config };

function getR2Config(): R2ConfigResult {
  const r2Credentials = {
    R2_ACCOUNT_ID: Deno.env.get("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID: Deno.env.get("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY: Deno.env.get("R2_SECRET_ACCESS_KEY"),
  };
  const missingCredentials = Object.entries(r2Credentials)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  // 認証情報が一つも無ければ「R2 未使用環境」と判断し、Storage フォールバックに委ねる。
  if (missingCredentials.length === Object.keys(r2Credentials).length) {
    return { status: "not-configured" };
  }

  // 一部だけ設定されている場合はキーのローテーション漏れ・タイポによる「R2 使用環境の
  // 設定不備」であり、下のバケット名チェックと同じ理由 (サイレント成功で孤児オブジェクトが
  // 残る) でフォールバックに倒さず必ずエラーとして表面化させる。
  if (missingCredentials.length > 0) {
    return {
      status: "misconfigured",
      reason: `R2 credentials are partially configured. Missing: ${missingCredentials.join(", ")}. Aborting instead of silently falling back to Supabase Storage.`,
    };
  }

  const { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } =
    r2Credentials as Record<string, string>;

  // 画像バケット名は apps/web/lib/r2.ts の getImageBucketName() と同じ規約でデフォルト値を
  // 持たず必須とする (同ファイルも未設定時は例外を投げている)。ここで `?? null` 等の
  // フォールバックにより静かに Storage 側へ倒すと、R2 認証情報だけが設定されバケット名の
  // 設定漏れ・タイポがあった場合に「何も削除せず errors: [] で success: true を返す」
  // というサイレント成功になる。退会削除としては最悪の失敗モード (孤児ストレージが
  // 気づかれないまま残り続ける) のため、設定不備は必ずエラーとして表面化させる。
  const imageBucket = Deno.env.get("R2_BUCKET_NAME");
  if (!imageBucket) {
    return {
      status: "misconfigured",
      reason:
        "R2 credentials are configured but R2_BUCKET_NAME is missing. Aborting instead of silently skipping image storage cleanup.",
    };
  }

  // 動画バケット名は apps/web/lib/r2-video.ts の getBucketName() と同じ規約で、
  // 未設定時は本番デフォルトバケットにフォールバックする (ローカル/検証環境でのみ
  // 環境変数で上書きする運用のため、未設定=本番相当という意味的な既定値が存在する)。
  // これにより画像バケット名と異なり「未設定=エラー」にはしない。
  const videoBucket = Deno.env.get("R2_VIDEO_BUCKET_NAME") ?? "swim-hub-videos-prod";

  return {
    status: "ok",
    config: {
      aws: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      imageBucket,
      videoBucket,
    },
  };
}

async function cleanupR2(userId: string, config: R2Config): Promise<string[]> {
  const errors: string[] = [];
  const { aws, endpoint, imageBucket, videoBucket } = config;

  const prefixGroups: Array<{ bucket: string; prefixes: readonly string[] }> = [
    { bucket: imageBucket, prefixes: IMAGE_STORAGE_PREFIXES },
    { bucket: videoBucket, prefixes: VIDEO_STORAGE_PREFIXES },
  ];

  for (const { bucket, prefixes } of prefixGroups) {
    for (const prefixName of prefixes) {
      // 安全制約: 必ず "{prefix}/{userId}/" というユーザーIDセグメントより深い階層でのみ削除する。
      // 例えば "practice-images/" のようにユーザーIDを含まないプレフィックスで削除すると、
      // 他ユーザーの画像・動画を巻き込んで消してしまう。
      const prefix = `${prefixName}/${userId}/`;
      try {
        const rawKeys = await listAllR2Keys(aws, endpoint, bucket, prefix);

        // Defense-in-depth: ListObjectsV2 は本来 prefix に一致するキーのみを返す契約だが、
        // S3互換サーバーの実装ミス・中間プロキシの改竄等で契約が破られた場合に備え、
        // クライアント側でも返却キーが本当にリクエストした prefix 配下かを再検証する。
        // この機能で最も警戒すべきは「他ユーザーのファイルを消す」事故であり、
        // サーバーの応答を無条件に信用しない。弾いたキーは削除せず警告ログにのみ残し、
        // fail-closed の errors には積まない。これはこのリクエスト自体の処理失敗では
        // なく「サーバー契約違反を検知して自衛した」結果であり、正しく削除できた
        // 他のキーの完了やユーザーの退会処理を妨げるべきではないため。
        const keys = rawKeys.filter((key) => {
          if (key.startsWith(prefix)) return true;
          console.warn(
            `delete-user-storage: rejecting out-of-prefix key returned by ListObjectsV2 ` +
              `(bucket=${bucket}, expectedPrefix=${prefix}): ${key}`,
          );
          return false;
        });

        if (keys.length > 0) {
          await deleteR2Keys(aws, endpoint, bucket, keys);
        }
      } catch (err) {
        errors.push(`R2 ${prefixName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return errors;
}

// --- Supabase Storage (R2 無効時のフォールバック) ---

/**
 * Supabase Storage の list() は指定フォルダ直下の1階層しか返さない。
 * practice-images / competition-images は "{userId}/{practiceId 等}/{fileName}" のように
 * userId の下にさらに ID フォルダを持つため、フォルダ (id === null のプレースホルダー) を
 * 検出したら再帰的に潜って実ファイルパスまで解決する。
 * list() は1ページ最大100件がデフォルトのため offset ページネーションで全件走査する。
 */
async function listAllFilePathsInStorage(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const filePaths: string[] = [];
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const { data: entries, error } = await supabase.storage
      .from(bucket)
      .list(folder, { limit: pageSize, offset });

    if (error) throw error;
    if (!entries || entries.length === 0) break;

    for (const entry of entries) {
      const entryPath = `${folder}/${entry.name}`;
      // Supabase Storage は実ディレクトリを持たず、フォルダは id === null のプレースホルダー
      // エントリとして list() に現れる。ファイルは id が非 null。
      if (entry.id === null) {
        const nested = await listAllFilePathsInStorage(supabase, bucket, entryPath);
        filePaths.push(...nested);
      } else {
        filePaths.push(entryPath);
      }
    }

    if (entries.length < pageSize) break;
    offset += pageSize;
  }

  return filePaths;
}

async function cleanupSupabaseStorage(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const errors: string[] = [];
  const REMOVE_BATCH_SIZE = 1000;

  for (const bucket of IMAGE_STORAGE_PREFIXES) {
    try {
      // 安全制約: 必ず userId フォルダ配下のみを走査・削除する (bucket 全体を対象にしない)。
      const filePaths = await listAllFilePathsInStorage(supabase, bucket, userId);

      for (let i = 0; i < filePaths.length; i += REMOVE_BATCH_SIZE) {
        const batch = filePaths.slice(i, i + REMOVE_BATCH_SIZE);
        const { error: removeError } = await supabase.storage.from(bucket).remove(batch);
        if (removeError) {
          errors.push(`Storage ${bucket}: ${removeError.message}`);
        }
      }
    } catch (err) {
      errors.push(`Storage ${bucket}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return errors;
}

// --- Factory ---

export function createDeleteUserStorageHandler() {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      if (req.method !== "POST") {
        return jsonResponse({ success: false, errors: ["Method not allowed"] }, 405);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !supabaseServiceRoleKey) {
        console.error("delete-user-storage: Missing required environment variables");
        return jsonResponse({ success: false, errors: ["Server configuration error"] }, 500);
      }

      if (!verifyServiceRoleAuth(req, supabaseServiceRoleKey)) {
        console.error("delete-user-storage: Unauthorized call");
        return jsonResponse({ success: false, errors: ["Unauthorized"] }, 401);
      }

      let body: { userId?: unknown };
      try {
        body = await req.json();
      } catch {
        return jsonResponse({ success: false, errors: ["Invalid JSON body"] }, 400);
      }

      const userId = body.userId;
      if (!userId || typeof userId !== "string") {
        return jsonResponse({ success: false, errors: ["userId is required"] }, 400);
      }

      const r2ConfigResult = getR2Config();
      if (r2ConfigResult.status === "misconfigured") {
        console.error("delete-user-storage: R2 misconfigured:", r2ConfigResult.reason);
        return jsonResponse({ success: false, errors: [r2ConfigResult.reason] }, 500);
      }

      const errors =
        r2ConfigResult.status === "ok"
          ? await cleanupR2(userId, r2ConfigResult.config)
          : await cleanupSupabaseStorage(createClient(supabaseUrl, supabaseServiceRoleKey), userId);

      if (errors.length > 0) {
        console.error("delete-user-storage: completed with errors:", errors);
        return jsonResponse({ success: false, errors }, 500);
      }

      return jsonResponse({ success: true });
    } catch (err) {
      console.error("delete-user-storage: Unexpected error:", err);
      return jsonResponse(
        { success: false, errors: [err instanceof Error ? err.message : String(err)] },
        500,
      );
    }
  };
}
