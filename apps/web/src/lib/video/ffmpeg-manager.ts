import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

/**
 * URL からフェッチして blob URL を返す。
 * @ffmpeg/util の toBlobURL は resp.ok を検証しないため、アセット欠落 (404) 時に
 * エラーページの blob が作られて無言でハングする。ここで status を検証して明示的に失敗させる。
 */
async function fetchToBlobURL(url: string, mimeType: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to load FFmpeg asset ${url}: ${resp.status}`);
  }
  const blob = await resp.blob();
  return URL.createObjectURL(new Blob([blob], { type: mimeType }));
}

/** Promise にタイムアウトを付ける（core.load() の無言ハング検出用）。 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const R2_BASE = "https://pub-22903ca2ced04f30b26d6f3838248897.r2.dev";
// マルチスレッド core は pthread 初期化に失敗すると load() が無言でハングするため、
// この時間で打ち切って単一スレッドへフォールバックする（アセット取得後の instantiate のみを計測）。
const MT_LOAD_TIMEOUT_MS = 10_000;

class FFmpegManager {
  private ffmpeg: FFmpeg | null = null;
  private loaded = false;
  private loading: Promise<FFmpeg> | null = null;

  async load(onProgress?: (progress: number) => void): Promise<FFmpeg> {
    if (this.ffmpeg && this.loaded) return this.ffmpeg;
    if (this.loading) return this.loading;

    this.loading = this._load(onProgress);
    try {
      const result = await this.loading;
      return result;
    } finally {
      this.loading = null;
    }
  }

  private createInstance(onProgress?: (progress: number) => void): FFmpeg {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      onProgress?.(Math.round(progress * 100));
    });
    return ffmpeg;
  }

  /** 指定 base から core をロードする。mt=true のとき worker を渡しタイムアウトで打ち切る。 */
  private async loadCore(ffmpeg: FFmpeg, baseURL: string, multiThreaded: boolean): Promise<void> {
    const coreURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm");
    if (multiThreaded) {
      const workerURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript");
      await withTimeout(
        ffmpeg.load({ coreURL, wasmURL, workerURL }),
        MT_LOAD_TIMEOUT_MS,
        "multi-threaded FFmpeg core load timed out",
      );
    } else {
      await ffmpeg.load({ coreURL, wasmURL });
    }
  }

  private async _load(onProgress?: (progress: number) => void): Promise<FFmpeg> {
    // 空白のみの env var は未設定扱い。独自 base 指定時は mt を試さず単一スレッドで扱う（アセット構成不明のため）。
    const configured = process.env.NEXT_PUBLIC_FFMPEG_BASE_URL?.trim();
    const overrideBase = configured ? configured.replace(/\/+$/, "") : null;

    // マルチスレッド core (2〜4倍高速) を優先。SharedArrayBuffer が使え独自 base 未指定のときのみ試行し、
    // アセット欠落 (404) や pthread 初期化の無言ハング時は単一スレッドへ自動フォールバックする。
    if (typeof SharedArrayBuffer !== "undefined" && !overrideBase) {
      const ffmpeg = this.createInstance(onProgress);
      try {
        await this.loadCore(ffmpeg, `${R2_BASE}/ffmpeg-mt`, true);
        this.ffmpeg = ffmpeg;
        this.loaded = true;
        return ffmpeg;
      } catch (err) {
        console.warn("[ffmpeg] マルチスレッド core を利用できないため単一スレッドにフォールバックします", err);
        ffmpeg.terminate();
      }
    }

    // 単一スレッド core（確実に動作。エンコードは遅い）
    const ffmpeg = this.createInstance(onProgress);
    await this.loadCore(ffmpeg, overrideBase ?? `${R2_BASE}/ffmpeg`, false);
    this.ffmpeg = ffmpeg;
    this.loaded = true;
    return ffmpeg;
  }

  async writeFile(name: string, data: Uint8Array | string): Promise<void> {
    const ffmpeg = await this.load();
    await ffmpeg.writeFile(name, data);
  }

  async readFile(name: string): Promise<Uint8Array> {
    const ffmpeg = await this.load();
    const data = await ffmpeg.readFile(name);
    return data as Uint8Array;
  }

  async exec(args: string[]): Promise<void> {
    const ffmpeg = await this.load();
    await ffmpeg.exec(args);
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const ffmpegManager = new FFmpegManager();
export { fetchFile };
