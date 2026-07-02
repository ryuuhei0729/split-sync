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

  private async _load(onProgress?: (progress: number) => void): Promise<FFmpeg> {
    this.ffmpeg = new FFmpeg();

    this.ffmpeg.on("progress", ({ progress }) => {
      onProgress?.(Math.round(progress * 100));
    });

    // 単一スレッド core を使用する。
    // マルチスレッド core (ffmpeg-mt) は blob URL 経由で生成される pthread ワーカーが
    // cross-origin isolation を継承できず、書き出しが 0% のまま無言でデッドロックするため使わない。
    const defaultBase = "https://pub-22903ca2ced04f30b26d6f3838248897.r2.dev/ffmpeg";
    // Treat empty/whitespace env var as unset so misconfigured deploys fall back safely
    const configured = process.env.NEXT_PUBLIC_FFMPEG_BASE_URL?.trim();
    const baseURL = configured ? configured.replace(/\/+$/, "") : defaultBase;

    const coreURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await fetchToBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm");

    await this.ffmpeg.load({ coreURL, wasmURL });

    this.loaded = true;
    return this.ffmpeg;
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
