"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useEditorStore } from "@/stores/editor-store";

interface WaveformDisplayProps {
  height?: number;
  onClickTime?: (time: number) => void;
}

export function WaveformDisplay({ height = 80, onClickTime }: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { waveformData, detectedSignalTime, videoMetadata } = useEditorStore();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = rect.width;
    const h = height;

    // Background
    ctx.fillStyle = "#F3F4F6";
    ctx.fillRect(0, 0, w, h);

    // Waveform bars - blue tinted
    const barWidth = Math.max(1, w / waveformData.length);

    for (let i = 0; i < waveformData.length; i++) {
      const intensity = waveformData[i];
      if (intensity === undefined) continue; // i < waveformData.length is enforced by the loop condition; guard is defensive only
      const x = (i / waveformData.length) * w;
      const barHeight = intensity * h * 0.9;

      // Brighter bars for louder sections
      const alpha = 0.2 + intensity * 0.6;
      ctx.fillStyle = `rgba(37, 99, 235, ${alpha})`;
      ctx.fillRect(x, (h - barHeight) / 2, barWidth, barHeight);
    }

    // Draw hover cursor line
    if (hoverX !== null) {
      ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw detected signal marker
    if (detectedSignalTime !== null && videoMetadata) {
      const markerX = (detectedSignalTime / videoMetadata.duration) * w;

      // Glow effect
      ctx.strokeStyle = "rgba(220, 38, 38, 0.3)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, h);
      ctx.stroke();

      // Vertical line
      ctx.strokeStyle = "#DC2626";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(markerX, 0);
      ctx.lineTo(markerX, h);
      ctx.stroke();

      // Triangle marker at top
      ctx.fillStyle = "#DC2626";
      ctx.beginPath();
      ctx.moveTo(markerX - 5, 0);
      ctx.lineTo(markerX + 5, 0);
      ctx.lineTo(markerX, 8);
      ctx.closePath();
      ctx.fill();
    }
  }, [waveformData, detectedSignalTime, videoMetadata, height, hoverX]);

  useEffect(() => {
    drawWaveform();
    const handleResize = () => drawWaveform();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawWaveform]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!videoMetadata || !onClickTime) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = x / rect.width;
      const time = ratio * videoMetadata.duration;
      onClickTime(time);
    },
    [videoMetadata, onClickTime],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!videoMetadata) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setHoverX(x);
      const ratio = x / rect.width;
      setHoverTime(ratio * videoMetadata.duration);
    },
    [videoMetadata],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverX(null);
    setHoverTime(null);
  }, []);

  if (!waveformData) return null;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg cursor-crosshair border border-border hover:border-primary/30 transition-colors"
        style={{ height }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
      {/* Hover time tooltip */}
      {hoverTime !== null && hoverX !== null && (
        <div
          className="absolute -top-7 pointer-events-none"
          style={{ left: hoverX, transform: "translateX(-50%)" }}
        >
          <span className="text-[10px] font-mono bg-surface-raised border border-border rounded px-1.5 py-0.5 text-foreground tabular-nums">
            {hoverTime.toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  );
}
