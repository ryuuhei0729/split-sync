import { useRef, useMemo, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type ViewStyle,
  type DimensionValue,
  type FlexAlignType,
} from "react-native";
import { useEditorStore } from "../../stores/editor-store";
import { formatTime } from "@swimhub-timer/shared";
import type { StopwatchAnchor } from "@swimhub-timer/shared";
import { FinishSummaryTable } from "../splits/FinishSummaryTable";

interface Props {
  videoWidth: number;
  videoHeight: number;
}

export const SPLIT_DISPLAY_DURATION_SECONDS = 3;

export function StopwatchOverlay({ videoWidth, videoHeight }: Props) {
  const config = useEditorStore((s) => s.stopwatchConfig);
  const startTime = useEditorStore((s) => s.startTime);
  const currentVideoTime = useEditorStore((s) => s.currentVideoTime);
  const splitTimes = useEditorStore((s) => s.splitTimes);
  const isFinished = useEditorStore((s) => s.isFinished);
  const finishTime = useEditorStore((s) => s.finishTime);
  const raceDistance = useEditorStore((s) => s.raceDistance);
  const updateStopwatchConfig = useEditorStore((s) => s.updateStopwatchConfig);

  const containerSize = useRef({ width: 0, height: 0 });
  const contentRect = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const timerDragStart = useRef({ x: 0, y: 0 });
  const summaryGesture = useRef<{
    mode: "pan" | "pinch";
    posStart: { x: number; y: number };
    scaleStart: number;
    pinchDistanceStart: number;
    panAnchor: { pageX: number; pageY: number };
  }>({
    mode: "pan",
    posStart: { x: 0, y: 0 },
    scaleStart: 1,
    pinchDistanceStart: 0,
    panAnchor: { pageX: 0, pageY: 0 },
  });

  const SUMMARY_SCALE_MIN = 0.4;
  const SUMMARY_SCALE_MAX = 3;

  const updateContentRect = useCallback(() => {
    const cw = containerSize.current.width;
    const ch = containerSize.current.height;
    if (cw === 0 || ch === 0 || videoWidth <= 0 || videoHeight <= 0) return;

    const containerAspect = cw / ch;
    const videoAspect = videoWidth / videoHeight;

    if (videoAspect > containerAspect) {
      const contentW = cw;
      const contentH = cw / videoAspect;
      contentRect.current = { x: 0, y: (ch - contentH) / 2, width: contentW, height: contentH };
    } else {
      const contentH = ch;
      const contentW = ch * videoAspect;
      contentRect.current = { x: (cw - contentW) / 2, y: 0, width: contentW, height: contentH };
    }
  }, [videoWidth, videoHeight]);

  const timerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const pos = useEditorStore.getState().stopwatchConfig.position;
          timerDragStart.current = { x: pos.x, y: pos.y };
        },
        onPanResponderMove: (_, gestureState) => {
          const { width, height } = contentRect.current;
          if (width === 0 || height === 0) return;

          const dx = gestureState.dx / width;
          const dy = gestureState.dy / height;

          const newX = Math.max(0, Math.min(1, timerDragStart.current.x + dx));
          const newY = Math.max(0, Math.min(1, timerDragStart.current.y + dy));

          updateStopwatchConfig({
            position: { x: newX, y: newY },
          });
        },
      }),
    [updateStopwatchConfig],
  );

  const summaryPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const cfg = useEditorStore.getState().stopwatchConfig;
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            summaryGesture.current = {
              mode: "pinch",
              posStart: { x: cfg.summaryPosition.x, y: cfg.summaryPosition.y },
              scaleStart: cfg.summaryScale,
              pinchDistanceStart: Math.sqrt(dx * dx + dy * dy),
              panAnchor: { pageX: touches[0].pageX, pageY: touches[0].pageY },
            };
          } else {
            const t0 = touches[0] ?? { pageX: 0, pageY: 0 };
            summaryGesture.current = {
              mode: "pan",
              posStart: { x: cfg.summaryPosition.x, y: cfg.summaryPosition.y },
              scaleStart: cfg.summaryScale,
              pinchDistanceStart: 0,
              panAnchor: { pageX: t0.pageX, pageY: t0.pageY },
            };
          }
        },
        onPanResponderMove: (e) => {
          const touches = e.nativeEvent.touches;
          const cfg = useEditorStore.getState().stopwatchConfig;
          const g = summaryGesture.current;

          if (touches.length >= 2) {
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (g.mode !== "pinch" || g.pinchDistanceStart <= 0) {
              // Enter (or restart) pinch with the current finger spread as baseline.
              summaryGesture.current = {
                mode: "pinch",
                posStart: { x: cfg.summaryPosition.x, y: cfg.summaryPosition.y },
                scaleStart: cfg.summaryScale,
                pinchDistanceStart: dist,
                panAnchor: { pageX: touches[0].pageX, pageY: touches[0].pageY },
              };
              return;
            }

            const ratio = dist / g.pinchDistanceStart;
            const newScale = Math.max(
              SUMMARY_SCALE_MIN,
              Math.min(SUMMARY_SCALE_MAX, g.scaleStart * ratio),
            );
            updateStopwatchConfig({ summaryScale: newScale });
            return;
          }

          // 1-finger pan. Reset the baseline if we just dropped from pinch.
          if (g.mode !== "pan") {
            const t0 = touches[0] ?? { pageX: g.panAnchor.pageX, pageY: g.panAnchor.pageY };
            summaryGesture.current = {
              mode: "pan",
              posStart: { x: cfg.summaryPosition.x, y: cfg.summaryPosition.y },
              scaleStart: cfg.summaryScale,
              pinchDistanceStart: 0,
              panAnchor: { pageX: t0.pageX, pageY: t0.pageY },
            };
            return;
          }

          const { width, height } = contentRect.current;
          if (width === 0 || height === 0) return;

          const t0 = touches[0];
          if (!t0) return;
          const dxPx = t0.pageX - g.panAnchor.pageX;
          const dyPx = t0.pageY - g.panAnchor.pageY;

          const newX = Math.max(0, Math.min(1, g.posStart.x + dxPx / width));
          const newY = Math.max(0, Math.min(1, g.posStart.y + dyPx / height));

          updateStopwatchConfig({
            summaryPosition: { x: newX, y: newY },
          });
        },
      }),
    [updateStopwatchConfig],
  );

  useEffect(() => {
    updateContentRect();
  }, [updateContentRect]);

  const onContainerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      containerSize.current = {
        width: e.nativeEvent.layout.width,
        height: e.nativeEvent.layout.height,
      };
      updateContentRect();
    },
    [updateContentRect],
  );

  const elapsedRaw =
    startTime !== null ? Math.max(0, currentVideoTime - startTime) : 0;

  // Match the web preview: surface only the most-recently passed split, for
  // SPLIT_DISPLAY_DURATION seconds after it is passed. Web reference:
  // apps/web/src/hooks/useCanvasCompositor.ts
  const activeSplit = useMemo(() => {
    if (startTime === null) return null;
    const cap = isFinished && finishTime !== null ? Math.min(elapsedRaw, finishTime) : elapsedRaw;
    const sorted = [...splitTimes].sort((a, b) => a.time - b.time);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      if (isFinished && finishTime !== null && raceDistance !== null) {
        // Suppress the auto-added split that mirrors raceDistance/finishTime —
        // it would just redisplay the timer's final reading.
        if (s.distance === raceDistance && s.time === finishTime) continue;
      }
      if (cap >= s.time && cap < s.time + SPLIT_DISPLAY_DURATION_SECONDS) {
        return s;
      }
    }
    return null;
  }, [splitTimes, elapsedRaw, isFinished, finishTime, raceDistance, startTime]);

  const scaleFactor =
    contentRect.current.width > 0 && videoWidth > 0 ? contentRect.current.width / videoWidth : 0.2;
  const watermarkFontSize = Math.max(8, Math.round(videoHeight * 0.06 * scaleFactor));

  if (startTime === null) return null;

  const elapsed = isFinished && finishTime !== null ? Math.min(elapsedRaw, finishTime) : elapsedRaw;
  const timeText = formatTime(elapsed);

  const scaledFontSize = config.fontSize * scaleFactor;
  const scaledPadding = config.padding * scaleFactor;
  const scaledRadius = config.borderRadius * scaleFactor;

  const timerWrapperStyle = getWrapperStyle(config.position, config.anchor);
  const summaryWrapperStyle = getWrapperStyle(config.summaryPosition, config.summaryAnchor);
  const cr = contentRect.current;

  const showSummary =
    isFinished &&
    finishTime !== null &&
    currentVideoTime - startTime >= finishTime;

  // Mirror the web split-display sizing (renderer.ts: splitFontSize ~ fontSize*0.55,
  // memo ~ fontSize*0.38, padding ~ padding*0.6).
  const splitFontSize = Math.max(8, Math.round(scaledFontSize * 0.55));
  const splitMemoFontSize = Math.max(7, Math.round(scaledFontSize * 0.38));
  const splitPadding = Math.max(3, Math.round(scaledPadding * 0.6));
  const splitGap = Math.max(2, Math.round(scaledPadding * 0.3));
  const splitRadius = Math.max(2, Math.round(scaledRadius * 0.6));
  const stackAlign = anchorAlignItems(config.anchor);
  const splitHorizontalStyle: ViewStyle =
    stackAlign === "flex-end"
      ? { right: 0 }
      : stackAlign === "center"
        ? { left: 0, right: 0, alignItems: "center" }
        : { left: 0 };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onContainerLayout}>
      <View
        style={{
          position: "absolute",
          left: cr.x,
          top: cr.y,
          width: cr.width,
          height: cr.height,
        }}
        pointerEvents="box-none"
      >
        {/* Watermark: bottom-right corner of video content */}
        <View
          style={{
            position: "absolute",
            right: "3%",
            bottom: "3%",
            flexDirection: "row",
            alignItems: "center",
            opacity: 0.3,
          }}
          pointerEvents="none"
        >
          <Image
            source={require("../../assets/icon.png")}
            style={{
              width: watermarkFontSize,
              height: watermarkFontSize,
              borderRadius: watermarkFontSize * 0.2,
              marginRight: watermarkFontSize * 0.3,
            }}
          />
          <Text
            style={{
              color: "white",
              fontSize: watermarkFontSize,
              fontWeight: "600",
            }}
          >
            SwimHub Timer
          </Text>
        </View>

        {/* Stopwatch timer — hidden while the summary is shown.
            The split badge is absolutely positioned below the timer so the
            timer's top edge stays fixed when a split appears (preview only;
            the export pipeline anchors the split independently). */}
        {!showSummary && (
          <View style={timerWrapperStyle} pointerEvents="box-none">
            <View
              {...timerPanResponder.panHandlers}
              style={{ alignItems: stackAlign }}
            >
              <View>
                <View
                  style={{
                    backgroundColor: config.backgroundColor,
                    borderRadius: scaledRadius,
                    padding: scaledPadding,
                  }}
                >
                  <Text
                    style={{
                      color: config.textColor,
                      fontSize: scaledFontSize,
                      fontWeight: "700",
                      fontFamily: config.fontFamily === "monospace" ? "monospace" : undefined,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {timeText}
                  </Text>
                </View>

                {activeSplit && (
                  <View
                    style={{
                      position: "absolute",
                      top: "100%",
                      marginTop: splitGap,
                      ...splitHorizontalStyle,
                    }}
                  >
                    <SplitBadge
                      split={activeSplit}
                      config={config}
                      fontSize={splitFontSize}
                      memoFontSize={splitMemoFontSize}
                      padding={splitPadding}
                      radius={splitRadius}
                    />
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Goal summary table — appears at finish; draggable + pinch-to-resize */}
        {showSummary && (
          <View style={summaryWrapperStyle} pointerEvents="box-none" testID="finish-summary-table">
            <View {...summaryPanResponder.panHandlers}>
              <FinishSummaryTable
                splitTimes={splitTimes}
                finishTime={finishTime!}
                config={{
                  textColor: config.textColor,
                  backgroundColor: config.backgroundColor,
                  fontFamily: config.fontFamily,
                }}
                scaleFactor={scaleFactor * config.summaryScale}
                raceDistance={raceDistance}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function pct(value: number): DimensionValue {
  return `${value * 100}%` as DimensionValue;
}

function anchorAlignItems(anchor: StopwatchAnchor): FlexAlignType {
  switch (anchor) {
    case "top-left":
    case "bottom-left":
      return "flex-start";
    case "top-right":
    case "bottom-right":
      return "flex-end";
    default:
      return "center";
  }
}

function formatDistance(distance: number): string {
  return Number.isInteger(distance) ? String(distance) : distance.toString();
}

interface SplitBadgeProps {
  split: { distance: number; time: number; lapTime: number | null; memo: string };
  config: { textColor: string; backgroundColor: string; fontFamily: string };
  fontSize: number;
  memoFontSize: number;
  padding: number;
  radius: number;
  marginTop?: number;
  marginBottom?: number;
}

function SplitBadge({
  split,
  config,
  fontSize,
  memoFontSize,
  padding,
  radius,
  marginTop,
  marginBottom,
}: SplitBadgeProps) {
  const timeStr = formatTime(split.time);
  const headline =
    split.lapTime !== null
      ? `${formatDistance(split.distance)}m: ${timeStr} (lap: ${formatTime(split.lapTime)})`
      : `${formatDistance(split.distance)}m: ${timeStr}`;
  const fontFamily = config.fontFamily === "monospace" ? "monospace" : undefined;

  return (
    <View
      style={{
        backgroundColor: config.backgroundColor,
        borderRadius: radius,
        padding,
        marginTop,
        marginBottom,
      }}
    >
      <Text
        style={{
          color: config.textColor,
          fontSize,
          fontWeight: "700",
          fontFamily,
          fontVariant: ["tabular-nums"],
        }}
      >
        {headline}
      </Text>
      {split.memo ? (
        <Text
          style={{
            color: config.textColor,
            fontSize: memoFontSize,
            fontFamily,
            opacity: 0.75,
            marginTop: Math.round(fontSize * 0.25),
          }}
        >
          {split.memo}
        </Text>
      ) : null}
    </View>
  );
}

export function getStopwatchWrapperStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
): ViewStyle {
  return getWrapperStyle(position, anchor);
}

function getWrapperStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
): ViewStyle {
  const base: ViewStyle = { position: "absolute" };

  switch (anchor) {
    case "top-left":
      return { ...base, left: pct(position.x), top: pct(position.y) };
    case "top-center":
      return {
        ...base,
        left: 0,
        right: 0,
        top: pct(position.y),
        flexDirection: "row",
        justifyContent: "center",
      };
    case "top-right":
      return { ...base, right: pct(1 - position.x), top: pct(position.y) };
    case "center":
      return {
        ...base,
        left: pct(position.x),
        top: pct(position.y),
        transform: [
          { translateX: "-50%" as unknown as number },
          { translateY: "-50%" as unknown as number },
        ],
      };
    case "bottom-left":
      return { ...base, left: pct(position.x), bottom: pct(1 - position.y) };
    case "bottom-center":
      return {
        ...base,
        left: 0,
        right: 0,
        bottom: pct(1 - position.y),
        flexDirection: "row",
        justifyContent: "center",
      };
    case "bottom-right":
      return { ...base, right: pct(1 - position.x), bottom: pct(1 - position.y) };
    default:
      return { ...base, left: pct(position.x), top: pct(position.y) };
  }
}
