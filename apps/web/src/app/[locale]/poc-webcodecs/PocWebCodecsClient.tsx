"use client";

/**
 * Phase 0 PoC — WebCodecs export engine real-device verification page.
 *
 * Not part of the production export flow (see `ExportDialog.tsx` / `useVideoExport.ts`,
 * which go through `export-dispatcher.ts`). This page exists so a human can open it on a
 * real iPhone and get a Go/No-Go read on:
 *   1. `VideoEncoder.isConfigSupported` results for 720p/1080p/original
 *   2. Whether the pipeline actually encodes a played-back-able MP4
 *   3. Whether OffscreenCanvas works inside a Web Worker (informational; see the probe file)
 *   4. Whether a rotated (portrait) source video comes out right-side-up
 *   5. Whether the source audio track survives the export (AAC passthrough)
 *   6. Wall-clock export duration
 *
 * Intentionally excluded from the production nav — see `page.tsx` for the noindex metadata.
 */
import { useCallback, useRef, useState } from "react";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { DEFAULT_STOPWATCH_CONFIG, type ExportResolution } from "@swimhub-timer/shared";
import { buildEncoderConfig } from "@/lib/video/webcodecs-encoder-config";
import { detectWebCodecsCapability } from "@/lib/video/webcodecs-capability";
import { exportVideoWithStopwatchWebCodecs } from "@/lib/video/webcodecs-export-pipeline";
import {
  probeOffscreenCanvasInWorker,
  type OffscreenCanvasWorkerProbeResult,
} from "./offscreen-canvas-worker-probe";

interface SourceProbeResult {
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  fps: number;
  videoCodec: string | null;
  hasAudio: boolean;
  audioCodec: string | null;
}

interface CapabilityRow {
  resolution: ExportResolution;
  width: number;
  height: number;
  bitrateMbps: string;
  codecString: string;
  levelName: string;
  supported: boolean;
  reason?: string;
}

interface ExportProbeResult {
  durationMs: number;
  outputVideoCodec: string | null;
  outputWidth: number;
  outputHeight: number;
  outputRotation: number;
  outputHasAudio: boolean;
  outputAudioCodec: string | null;
  blobUrl: string;
}

const CANDIDATE_RESOLUTIONS: ExportResolution[] = ["720", "1080", "original"];

async function probeSourceFile(file: File): Promise<SourceProbeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error("No video track found in this file.");
  }

  const [displayWidth, displayHeight, rotation, videoCodec, { averagePacketRate }] = await Promise.all([
    videoTrack.getDisplayWidth(),
    videoTrack.getDisplayHeight(),
    videoTrack.getRotation(),
    videoTrack.getCodec(),
    videoTrack.computePacketStats(60),
  ]);

  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack ? await audioTrack.getCodec() : null;

  return {
    displayWidth,
    displayHeight,
    rotation,
    fps: averagePacketRate,
    videoCodec,
    hasAudio: audioTrack !== null,
    audioCodec,
  };
}

async function probeOutputFile(blob: Blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const videoTrack = await input.getPrimaryVideoTrack();
  const audioTrack = await input.getPrimaryAudioTrack();

  return {
    outputVideoCodec: videoTrack ? await videoTrack.getCodec() : null,
    outputWidth: videoTrack ? await videoTrack.getDisplayWidth() : 0,
    outputHeight: videoTrack ? await videoTrack.getDisplayHeight() : 0,
    outputRotation: videoTrack ? await videoTrack.getRotation() : 0,
    outputHasAudio: audioTrack !== null,
    outputAudioCodec: audioTrack ? await audioTrack.getCodec() : null,
  };
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-muted-foreground">…</span>;
  return (
    <span className={ok ? "text-emerald-400" : "text-destructive"}>{ok ? "PASS" : "FAIL"}</span>
  );
}

export function PocWebCodecsClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceProbe, setSourceProbe] = useState<SourceProbeResult | null>(null);
  const [capabilityRows, setCapabilityRows] = useState<CapabilityRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportProbeResult | null>(null);
  const [exportProgress, setExportProgress] = useState(0);
  const [workerProbe, setWorkerProbe] = useState<OffscreenCanvasWorkerProbeResult | null>(null);
  const [workerProbeRunning, setWorkerProbeRunning] = useState(false);

  const currentFileRef = useRef<File | null>(null);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    currentFileRef.current = file;
    setFileName(file.name);
    setExportResult(null);
    setExportError(null);
    setCapabilityRows(null);
    setSourceProbe(null);
    setBusy(true);

    try {
      const probe = await probeSourceFile(file);
      setSourceProbe(probe);

      const fps = probe.fps > 0 ? probe.fps : 30;
      const rows = await Promise.all(
        CANDIDATE_RESOLUTIONS.map(async (resolution): Promise<CapabilityRow> => {
          const config = buildEncoderConfig(probe.displayWidth, probe.displayHeight, resolution, fps);
          const capability = await detectWebCodecsCapability({
            width: config.width,
            height: config.height,
            bitrate: config.bitrate,
            framerate: fps,
            codecString: config.codecString,
          });
          return {
            resolution,
            width: config.width,
            height: config.height,
            bitrateMbps: (config.bitrate / 1_000_000).toFixed(1),
            codecString: config.codecString,
            levelName: config.levelName,
            supported: capability.supported,
            reason: capability.reason,
          };
        }),
      );
      setCapabilityRows(rows);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to probe the source file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const runExport = useCallback(async () => {
    const file = currentFileRef.current;
    if (!file) return;

    setBusy(true);
    setExportError(null);
    setExportResult(null);
    setExportProgress(0);

    const startedAt = performance.now();
    try {
      const blob = await exportVideoWithStopwatchWebCodecs(
        file,
        0,
        DEFAULT_STOPWATCH_CONFIG,
        sourceProbe?.displayHeight ?? 0,
        { resolution: "1080" },
        (percent) => setExportProgress(percent),
        true,
        [],
        false,
        null,
        null,
      );
      const durationMs = performance.now() - startedAt;
      const outputProbe = await probeOutputFile(blob);
      const blobUrl = URL.createObjectURL(blob);

      setExportResult({ durationMs, blobUrl, ...outputProbe });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "WebCodecs export failed.");
    } finally {
      setBusy(false);
    }
  }, [sourceProbe]);

  const runWorkerProbe = useCallback(async () => {
    setWorkerProbeRunning(true);
    try {
      const result = await probeOffscreenCanvasInWorker();
      setWorkerProbe(result);
    } finally {
      setWorkerProbeRunning(false);
    }
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">WebCodecs Export — PoC / Real-Device Check</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Internal diagnostic page (noindex). Not linked from the production app.
        </p>
      </div>

      <section className="bg-surface rounded-2xl border border-border p-5 space-y-4">
        <h2 className="font-semibold text-sm">1–2. Source file + isConfigSupported</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="text-sm"
        />
        {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}

        {sourceProbe && (
          <div className="text-sm space-y-1">
            <p>
              Display size: {sourceProbe.displayWidth}x{sourceProbe.displayHeight} · rotation:{" "}
              {sourceProbe.rotation}° · fps: {sourceProbe.fps.toFixed(1)}
            </p>
            <p>Video codec: {sourceProbe.videoCodec ?? "unknown"}</p>
            <p>
              Audio track: {sourceProbe.hasAudio ? `present (${sourceProbe.audioCodec ?? "unknown"})` : "none"}
            </p>
          </div>
        )}

        {capabilityRows && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Resolution</th>
                <th>Output size</th>
                <th>Bitrate</th>
                <th>Codec string (level)</th>
                <th>isConfigSupported</th>
              </tr>
            </thead>
            <tbody>
              {capabilityRows.map((row) => (
                <tr key={row.resolution} className="border-t border-border">
                  <td className="py-1.5">{row.resolution}</td>
                  <td>
                    {row.width}x{row.height}
                  </td>
                  <td>{row.bitrateMbps} Mbps</td>
                  <td>
                    {row.codecString} ({row.levelName})
                  </td>
                  <td>
                    <StatusDot ok={row.supported} />
                    {row.reason && <span className="text-muted-foreground ml-1">({row.reason})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bg-surface rounded-2xl border border-border p-5 space-y-4">
        <h2 className="font-semibold text-sm">2, 4, 5, 6. Run WebCodecs export (1080p)</h2>
        <button
          type="button"
          disabled={!sourceProbe || busy}
          onClick={runExport}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
        >
          {busy ? `Encoding… ${exportProgress}%` : "Run export"}
        </button>

        {exportError && <p className="text-sm text-destructive">{exportError}</p>}

        {exportResult && (
          <div className="text-sm space-y-2">
            <p>Duration: {(exportResult.durationMs / 1000).toFixed(2)}s</p>
            <p>
              Output: {exportResult.outputWidth}x{exportResult.outputHeight} · rotation:{" "}
              {exportResult.outputRotation}° · codec: {exportResult.outputVideoCodec ?? "unknown"}
            </p>
            <p>
              Audio passthrough:{" "}
              <StatusDot ok={exportResult.outputHasAudio} />
              {exportResult.outputHasAudio && ` (${exportResult.outputAudioCodec ?? "unknown"})`}
            </p>
            <video
              src={exportResult.blobUrl}
              controls
              playsInline
              className="w-full max-w-sm rounded-lg border border-border"
            />
            <p className="text-xs text-muted-foreground">
              Visually confirm the video plays back right-side-up (item 4) and with audio (item 5).
            </p>
          </div>
        )}
      </section>

      <section className="bg-surface rounded-2xl border border-border p-5 space-y-4">
        <h2 className="font-semibold text-sm">3. OffscreenCanvas inside a Web Worker</h2>
        <p className="text-xs text-muted-foreground">
          Informational only — the real export pipeline runs on the main thread and does not
          depend on this.
        </p>
        <button
          type="button"
          disabled={workerProbeRunning}
          onClick={runWorkerProbe}
          className="text-sm px-4 py-2 rounded-lg bg-surface-raised border border-border disabled:opacity-40"
        >
          {workerProbeRunning ? "Probing…" : "Run worker probe"}
        </button>
        {workerProbe && (
          <p className="text-sm">
            <StatusDot ok={workerProbe.ok} />
            {workerProbe.reason && <span className="text-muted-foreground ml-1">({workerProbe.reason})</span>}
          </p>
        )}
      </section>
    </div>
  );
}
