/**
 * Skia preview overlay (Phase 3).
 *
 * Renders the timer / split / summary / watermark with the SAME shared `draw*`
 * functions the export uses, through Skia — so "what the editor shows" is
 * literally "what the export draws". This replaces the per-element React Native
 * `<Text>`/`<View>` rendering in StopwatchOverlay's *visual* layer.
 *
 * The drag/resize handles stay as RN Views (see StopwatchOverlay) — they aren't
 * exported pixels, so there's no need to Skia-ify them. This component is the
 * read-only picture; mount the existing handle layer above it.
 *
 * The picture is drawn at native video resolution and scaled down to the
 * letterboxed content rect, mirroring the export's native-resolution draw.
 */
import { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, type LayoutChangeEvent } from "react-native";
import {
  Canvas,
  Picture,
  Group,
  Skia,
  createPicture,
  type SkImage,
} from "@shopify/react-native-skia";
import { Asset } from "expo-asset";
import { useEditorStore } from "../../stores/editor-store";
import {
  drawStopwatch,
  drawPassedSplit,
  drawFinishSummary,
  drawWatermark,
  getStopwatchBounds,
  getFinishSummaryBounds,
  SPLIT_DISPLAY_DURATION_SECONDS,
} from "@swimhub-timer/shared";
import type { SplitTime, Rect } from "@swimhub-timer/shared";
import { computeSummaryStartT } from "../../lib/video/export-pipeline";
import {
  loadOverlayTypefaces,
  MOBILE_WATERMARK_OPTIONS,
  type OverlayTypefaces,
} from "../../lib/overlay/fonts";
import { SkiaOverlayContext } from "../../lib/overlay/skia-context";

interface Props {
  videoWidth: number;
  videoHeight: number;
}

interface ContentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function StopwatchSkiaOverlay({ videoWidth, videoHeight }: Props) {
  const config = useEditorStore((s) => s.stopwatchConfig);
  const startTime = useEditorStore((s) => s.startTime);
  const currentVideoTime = useEditorStore((s) => s.currentVideoTime);
  const splitTimes = useEditorStore((s) => s.splitTimes);
  const isFinished = useEditorStore((s) => s.isFinished);
  const finishTime = useEditorStore((s) => s.finishTime);
  const raceDistance = useEditorStore((s) => s.raceDistance);
  const videoDuration = useEditorStore((s) => s.videoMetadata?.duration ?? 0);
  // Skia owns the geometry: it draws the visuals AND publishes the on-screen
  // bounds so the RN gesture layer can glue its hit areas + selection frame to
  // the exact same box (single source of truth = shared calculatePosition).
  const setPreviewBounds = useEditorStore((s) => s.setPreviewBounds);

  const [typefaces, setTypefaces] = useState<OverlayTypefaces | null>(null);
  const [icon, setIcon] = useState<SkImage | null>(null);
  const [content, setContent] = useState<ContentRect>({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    let alive = true;
    loadOverlayTypefaces().then((tf) => alive && setTypefaces(tf));
    (async () => {
      const asset = Asset.fromModule(require("../../assets/icon.png"));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      if (!uri) return;
      const data = await Skia.Data.fromURI(uri);
      const img = Skia.Image.MakeImageFromEncoded(data);
      if (alive && img) setIcon(img);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: cw, height: ch } = e.nativeEvent.layout;
    if (cw === 0 || ch === 0 || videoWidth <= 0 || videoHeight <= 0) return;
    const containerAspect = cw / ch;
    const videoAspect = videoWidth / videoHeight;
    const next: ContentRect =
      videoAspect > containerAspect
        ? { x: 0, y: (ch - cw / videoAspect) / 2, width: cw, height: cw / videoAspect }
        : { x: (cw - ch * videoAspect) / 2, y: 0, width: ch * videoAspect, height: ch };
    setContent((prev) =>
      prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height
        ? prev
        : next,
    );
  };

  const elapsed = useMemo(() => {
    const raw = startTime !== null ? Math.max(0, currentVideoTime - startTime) : 0;
    return isFinished && finishTime !== null ? Math.min(raw, finishTime) : raw;
  }, [startTime, currentVideoTime, isFinished, finishTime]);

  const activeSplit = useMemo<SplitTime | null>(() => {
    if (startTime === null) return null;
    const cap = isFinished && finishTime !== null ? Math.min(elapsed, finishTime) : elapsed;
    const sorted = [...splitTimes].sort((a, b) => a.time - b.time);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      if (isFinished && finishTime !== null && raceDistance !== null) {
        if (s.distance === raceDistance && s.time === finishTime) continue;
      }
      if (cap >= s.time && cap < s.time + SPLIT_DISPLAY_DURATION_SECONDS) return s;
    }
    return null;
  }, [splitTimes, elapsed, isFinished, finishTime, raceDistance, startTime]);

  // The timer freezes at finishTime (elapsed is capped above); the summary
  // appears at computeSummaryStartT — the SAME clamped absolute time the export
  // uses. Previously the preview used the unclamped `finishTime +
  // SUMMARY_DELAY_SECONDS`, which the clip could end before reaching, so a
  // finish near the clip end showed a summary in the export that the preview
  // never displayed. Sharing computeSummaryStartT also hides the timer at the
  // same instant the export's timer-sequence overlay ends (endT = this value).
  const summaryStartAbs = useMemo(
    () => (startTime !== null ? computeSummaryStartT(startTime, finishTime, videoDuration) : null),
    [startTime, finishTime, videoDuration],
  );
  const showSummary =
    isFinished &&
    finishTime !== null &&
    startTime !== null &&
    summaryStartAbs !== null &&
    currentVideoTime >= summaryStartAbs;

  // Draw the picture AND capture the native-resolution bounds of the timer /
  // summary in the same pass (both need the Skia measuring context).
  const { picture, timerBoundsNative, summaryBoundsNative } = useMemo(() => {
    if (!typefaces || videoWidth <= 0 || videoHeight <= 0) {
      return { picture: null, timerBoundsNative: null, summaryBoundsNative: null };
    }
    const size = { width: videoWidth, height: videoHeight };
    let timerB: Rect | null = null;
    let summaryB: Rect | null = null;
    const pic = createPicture(
      (canvas) => {
        const ctx = new SkiaOverlayContext(canvas, typefaces);
        if (showSummary && finishTime !== null) {
          const rect = { x: 0, y: 0, width: videoWidth, height: videoHeight };
          summaryB = getFinishSummaryBounds(ctx, config, splitTimes, finishTime, raceDistance, rect);
          drawFinishSummary(ctx, config, splitTimes, finishTime, raceDistance, rect);
        } else {
          timerB = getStopwatchBounds(ctx, size, config, elapsed);
          drawStopwatch(ctx, size, config, elapsed);
          if (activeSplit) drawPassedSplit(ctx, size, config, elapsed, activeSplit);
        }
        if (icon) {
          drawWatermark(ctx, size, icon, MOBILE_WATERMARK_OPTIONS);
        }
      },
      Skia.XYWHRect(0, 0, videoWidth, videoHeight),
    );
    return { picture: pic, timerBoundsNative: timerB, summaryBoundsNative: summaryB };
  }, [
    typefaces,
    icon,
    videoWidth,
    videoHeight,
    config,
    elapsed,
    activeSplit,
    showSummary,
    finishTime,
    splitTimes,
    raceDistance,
  ]);

  const scale = content.width > 0 ? content.width / videoWidth : 0;

  // Publish on-screen bounds (overlay-root coords) so the RN gesture layer can
  // align to the Skia geometry. Rounded + change-gated to avoid churn.
  useEffect(() => {
    if (scale <= 0) return;
    const toScreen = (b: Rect | null): Rect | null =>
      b
        ? {
            x: content.x + b.x * scale,
            y: content.y + b.y * scale,
            width: b.width * scale,
            height: b.height * scale,
          }
        : null;
    setPreviewBounds({ timer: toScreen(timerBoundsNative), summary: toScreen(summaryBoundsNative) });
  }, [timerBoundsNative, summaryBoundsNative, scale, content.x, content.y, setPreviewBounds]);

  if (startTime === null) {
    return <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} />;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {picture && scale > 0 && (
        <Canvas
          style={{
            position: "absolute",
            left: content.x,
            top: content.y,
            width: content.width,
            height: content.height,
          }}
        >
          <Group transform={[{ scale }]}>
            <Picture picture={picture} />
          </Group>
        </Canvas>
      )}
    </View>
  );
}
