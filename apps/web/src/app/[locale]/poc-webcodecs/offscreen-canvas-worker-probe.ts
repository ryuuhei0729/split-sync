/**
 * PoC-only diagnostic: checks whether this browser can create an `OffscreenCanvas` and
 * get a 2D context *inside a Web Worker*. The production export pipeline
 * (`webcodecs-export-pipeline.ts`) intentionally runs on the main thread — mediabunny's
 * Sink/Source classes don't require a worker — but iOS Safari has historically had bugs
 * with `OffscreenCanvas` inside workers, which would matter for a future off-main-thread
 * iteration. This result is informational only and does not affect the real pipeline.
 */
const WORKER_SOURCE = `
self.onmessage = () => {
  try {
    if (typeof OffscreenCanvas === "undefined") {
      self.postMessage({ ok: false, reason: "OffscreenCanvas is not available in this worker." });
      return;
    }
    const canvas = new OffscreenCanvas(64, 64);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      self.postMessage({ ok: false, reason: "Failed to get a 2D context from OffscreenCanvas in this worker." });
      return;
    }
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 64, 64);
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, reason: err instanceof Error ? err.message : String(err) });
  }
};
`;

export interface OffscreenCanvasWorkerProbeResult {
  ok: boolean;
  reason?: string;
}

export function probeOffscreenCanvasInWorker(): Promise<OffscreenCanvasWorkerProbeResult> {
  return new Promise((resolve) => {
    if (typeof Worker === "undefined") {
      resolve({ ok: false, reason: "Web Worker is not available in this browser." });
      return;
    }

    const blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(blobUrl);

    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ ok: false, reason: "Worker probe timed out after 5s." });
    }, 5000);

    worker.onmessage = (event: MessageEvent<OffscreenCanvasWorkerProbeResult>) => {
      clearTimeout(timeout);
      cleanup();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      cleanup();
      resolve({ ok: false, reason: event.message || "Worker threw an uncaught error." });
    };

    worker.postMessage(null);
  });
}
