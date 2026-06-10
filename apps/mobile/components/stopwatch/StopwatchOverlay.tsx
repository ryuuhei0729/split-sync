import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
  type ViewStyle,
  type DimensionValue,
  type FlexAlignType,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEditorStore } from "../../stores/editor-store";
import {
  formatTime,
  STOPWATCH_FONT_SIZE_MIN,
  SPLIT_DISPLAY_DURATION_SECONDS,
  SUMMARY_DELAY_SECONDS,
} from "@swimhub-timer/shared";
import type { StopwatchAnchor } from "@swimhub-timer/shared";
import { FinishSummaryTable } from "../splits/FinishSummaryTable";

interface Props {
  videoWidth: number;
  videoHeight: number;
  /**
   * When true, this overlay renders its layout + drag/resize handles but makes
   * the visible chrome (timer box/text, split badge, summary table, watermark)
   * transparent/omitted. Used in the Skia preview (Phase 3): StopwatchSkiaOverlay
   * draws the WYSIWYG pixels underneath, and this layer sits on top purely for
   * gesture handling, so editing keeps working while the visuals match export.
   */
  hideVisuals?: boolean;
}

// Re-exported from the shared single source of truth (kept for existing importers).
export { SPLIT_DISPLAY_DURATION_SECONDS };

const TIMER_EDIT_BORDER_COLOR = "#3B82F6";
const TIMER_EDIT_BORDER_WIDTH = 2;
const RESIZE_HANDLE_SIZE = 28;
const HANDLE_OVERLAP_PAD = Math.round(RESIZE_HANDLE_SIZE / 2);
const TAP_MOVE_THRESHOLD_PX = 6;
const TAP_MAX_DURATION_MS = 250;

export function StopwatchOverlay({ videoWidth, videoHeight, hideVisuals = false }: Props) {
  const config = useEditorStore((s) => s.stopwatchConfig);
  const startTime = useEditorStore((s) => s.startTime);
  const currentVideoTime = useEditorStore((s) => s.currentVideoTime);
  const splitTimes = useEditorStore((s) => s.splitTimes);
  const isFinished = useEditorStore((s) => s.isFinished);
  const finishTime = useEditorStore((s) => s.finishTime);
  const raceDistance = useEditorStore((s) => s.raceDistance);
  const updateStopwatchConfig = useEditorStore((s) => s.updateStopwatchConfig);
  // Publish editing state so the Skia preview defers the element under edit.
  const setStoreTimerEditing = useEditorStore((s) => s.setTimerEditing);
  const setStoreSummaryEditing = useEditorStore((s) => s.setSummaryEditing);
  // On-screen bounds published by the Skia preview — the gesture layer (when
  // hideVisuals) positions its hit areas + selection frame from these so the
  // chrome is glued to the Skia glyphs (single geometry, no jump).
  const timerPreviewBounds = useEditorStore((s) => s.timerPreviewBounds);
  const summaryPreviewBounds = useEditorStore((s) => s.summaryPreviewBounds);

  // Tracking content rect in state (not just a ref) so the wrapper can be
  // positioned in absolute pixels — percentage-based transforms didn't apply
  // reliably on first paint, leaving the timer clipped at the top-left.
  const [contentRect, setContentRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [timerLayout, setTimerLayout] = useState<{ width: number; height: number } | null>(null);
  const [summaryLayout, setSummaryLayout] = useState<{ width: number; height: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);

  // Mirror local editing state into the store so StopwatchSkiaOverlay can skip
  // drawing the element currently under edit (the RN chrome below renders it
  // instead, keeping the selection frame aligned with the glyphs). Reset on
  // unmount so a stale "editing" flag never hides the Skia element.
  useEffect(() => {
    setStoreTimerEditing(editing);
  }, [editing, setStoreTimerEditing]);
  useEffect(() => {
    setStoreSummaryEditing(summaryEditing);
  }, [summaryEditing, setStoreSummaryEditing]);
  useEffect(
    () => () => {
      setStoreTimerEditing(false);
      setStoreSummaryEditing(false);
    },
    [setStoreTimerEditing, setStoreSummaryEditing],
  );

  const containerSize = useRef({ width: 0, height: 0 });

  const gestureRefs = useRef({
    contentRect,
    scaleFactor: 0,
    editing,
    summaryEditing,
  });
  gestureRefs.current.contentRect = contentRect;
  gestureRefs.current.editing = editing;
  gestureRefs.current.summaryEditing = summaryEditing;

  const timerDragStart = useRef({ x: 0, y: 0 });
  const timerDidMove = useRef(false);
  const timerGrantTime = useRef(0);
  const resizeStartFontSize = useRef(0);
  const summaryDidMove = useRef(false);
  const summaryGrantTime = useRef(0);
  const resizeStartSummaryScale = useRef(1);
  const initialCenterApplied = useRef(false);

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

  const SUMMARY_SCALE_MIN = 0.1;

  const updateContentRect = useCallback(() => {
    const cw = containerSize.current.width;
    const ch = containerSize.current.height;
    if (cw === 0 || ch === 0 || videoWidth <= 0 || videoHeight <= 0) return;

    const containerAspect = cw / ch;
    const videoAspect = videoWidth / videoHeight;

    const next =
      videoAspect > containerAspect
        ? {
            x: 0,
            y: (ch - cw / videoAspect) / 2,
            width: cw,
            height: cw / videoAspect,
          }
        : {
            x: (cw - ch * videoAspect) / 2,
            y: 0,
            width: ch * videoAspect,
            height: ch,
          };

    setContentRect((prev) =>
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next,
    );
  }, [videoWidth, videoHeight]);

  const timerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          const pos = useEditorStore.getState().stopwatchConfig.position;
          timerDragStart.current = { x: pos.x, y: pos.y };
          timerDidMove.current = false;
          timerGrantTime.current = Date.now();
        },
        onPanResponderMove: (_, gestureState) => {
          if (
            Math.abs(gestureState.dx) > TAP_MOVE_THRESHOLD_PX ||
            Math.abs(gestureState.dy) > TAP_MOVE_THRESHOLD_PX
          ) {
            timerDidMove.current = true;
          }
          if (!gestureRefs.current.editing || !timerDidMove.current) return;

          const cr = gestureRefs.current.contentRect;
          if (cr.width === 0 || cr.height === 0) return;

          const dx = gestureState.dx / cr.width;
          const dy = gestureState.dy / cr.height;

          const newX = Math.max(0, Math.min(1, timerDragStart.current.x + dx));
          const newY = Math.max(0, Math.min(1, timerDragStart.current.y + dy));

          updateStopwatchConfig({ position: { x: newX, y: newY } });
        },
        onPanResponderRelease: (_, gestureState) => {
          const elapsed = Date.now() - timerGrantTime.current;
          const moved =
            timerDidMove.current ||
            Math.abs(gestureState.dx) > TAP_MOVE_THRESHOLD_PX ||
            Math.abs(gestureState.dy) > TAP_MOVE_THRESHOLD_PX;
          if (!moved && elapsed < TAP_MAX_DURATION_MS) {
            setEditing((prev) => !prev);
          }
        },
      }),
    [updateStopwatchConfig],
  );

  // The handle uses capture-phase shouldSet so the parent timer responder
  // can't claim the gesture first. This matters because the handle is a
  // descendant of the timerPanResponder's view.
  const resizePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          resizeStartFontSize.current =
            useEditorStore.getState().stopwatchConfig.fontSize;
        },
        onPanResponderMove: (_, gestureState) => {
          // Up-right drag enlarges; down-left shrinks. Convert screen-pixel
          // drag to video-resolution font size using the current scale factor
          // so the gesture feels 1:1 with the rendered timer. No upper cap —
          // the timer can grow as large as the user wants.
          const sf = gestureRefs.current.scaleFactor || 0.2;
          const deltaScreenPx = gestureState.dx - gestureState.dy;
          const newSize = Math.max(
            STOPWATCH_FONT_SIZE_MIN,
            resizeStartFontSize.current + deltaScreenPx / sf,
          );
          updateStopwatchConfig({ fontSize: Math.round(newSize) });
        },
      }),
    [updateStopwatchConfig],
  );

  const summaryPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const cfg = useEditorStore.getState().stopwatchConfig;
          const touches = e.nativeEvent.touches;
          summaryDidMove.current = false;
          summaryGrantTime.current = Date.now();
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
        onPanResponderMove: (e, gestureState) => {
          if (
            Math.abs(gestureState.dx) > TAP_MOVE_THRESHOLD_PX ||
            Math.abs(gestureState.dy) > TAP_MOVE_THRESHOLD_PX
          ) {
            summaryDidMove.current = true;
          }

          const touches = e.nativeEvent.touches;
          const cfg = useEditorStore.getState().stopwatchConfig;
          const g = summaryGesture.current;

          if (touches.length >= 2) {
            // Pinch still works regardless of edit mode (multi-touch is an
            // explicit resize gesture).
            const dx = touches[0].pageX - touches[1].pageX;
            const dy = touches[0].pageY - touches[1].pageY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (g.mode !== "pinch" || g.pinchDistanceStart <= 0) {
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
            const newScale = Math.max(SUMMARY_SCALE_MIN, g.scaleStart * ratio);
            updateStopwatchConfig({ summaryScale: newScale });
            return;
          }

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

          if (!gestureRefs.current.summaryEditing || !summaryDidMove.current) return;

          const cr = gestureRefs.current.contentRect;
          if (cr.width === 0 || cr.height === 0) return;

          const t0 = touches[0];
          if (!t0) return;
          const dxPx = t0.pageX - g.panAnchor.pageX;
          const dyPx = t0.pageY - g.panAnchor.pageY;

          const newX = Math.max(0, Math.min(1, g.posStart.x + dxPx / cr.width));
          const newY = Math.max(0, Math.min(1, g.posStart.y + dyPx / cr.height));

          updateStopwatchConfig({
            summaryPosition: { x: newX, y: newY },
          });
        },
        onPanResponderRelease: (_, gestureState) => {
          const elapsed = Date.now() - summaryGrantTime.current;
          const moved =
            summaryDidMove.current ||
            Math.abs(gestureState.dx) > TAP_MOVE_THRESHOLD_PX ||
            Math.abs(gestureState.dy) > TAP_MOVE_THRESHOLD_PX;
          if (!moved && elapsed < TAP_MAX_DURATION_MS) {
            setSummaryEditing((prev) => !prev);
          }
        },
      }),
    [updateStopwatchConfig],
  );

  // Resize handle for the summary — mirrors the timer's resize behaviour.
  const summaryResizePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          resizeStartSummaryScale.current =
            useEditorStore.getState().stopwatchConfig.summaryScale;
        },
        onPanResponderMove: (_, gestureState) => {
          // Up-right enlarges; down-left shrinks. ~200px drag traverses a full
          // unit of scale, regardless of current size.
          const deltaScreenPx = gestureState.dx - gestureState.dy;
          const newScale = Math.max(
            SUMMARY_SCALE_MIN,
            resizeStartSummaryScale.current + deltaScreenPx / 200,
          );
          updateStopwatchConfig({ summaryScale: newScale });
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

  const onTimerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setTimerLayout((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  const onSummaryLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSummaryLayout((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );
  }, []);

  // Re-center the timer the first time both the content rect and the timer
  // have been measured, but only if the user has not already moved it.
  useEffect(() => {
    // In Skia-preview mode geometry comes from the shared calculatePosition
    // (so preview == export); this RN-layout-based recenter would fight it.
    if (hideVisuals) return;
    if (initialCenterApplied.current) return;
    if (contentRect.width === 0 || contentRect.height === 0) return;
    if (!timerLayout) return;

    const pos = useEditorStore.getState().stopwatchConfig.position;
    const isAtDefault = Math.abs(pos.x - 0.5) < 1e-6 && Math.abs(pos.y - 0.5) < 1e-6;
    initialCenterApplied.current = true;
    if (!isAtDefault) return;

    const newX = Math.max(0, 0.5 - timerLayout.width / (2 * contentRect.width));
    const newY = Math.min(1, 0.5 + timerLayout.height / (2 * contentRect.height));
    updateStopwatchConfig({ position: { x: newX, y: newY } });
  }, [contentRect, timerLayout, updateStopwatchConfig, hideVisuals]);

  const elapsedRaw =
    startTime !== null ? Math.max(0, currentVideoTime - startTime) : 0;

  const activeSplit = useMemo(() => {
    if (startTime === null) return null;
    const cap = isFinished && finishTime !== null ? Math.min(elapsedRaw, finishTime) : elapsedRaw;
    const sorted = [...splitTimes].sort((a, b) => a.time - b.time);
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      if (isFinished && finishTime !== null && raceDistance !== null) {
        if (s.distance === raceDistance && s.time === finishTime) continue;
      }
      if (cap >= s.time && cap < s.time + SPLIT_DISPLAY_DURATION_SECONDS) {
        return s;
      }
    }
    return null;
  }, [splitTimes, elapsedRaw, isFinished, finishTime, raceDistance, startTime]);

  const scaleFactor =
    contentRect.width > 0 && videoWidth > 0 ? contentRect.width / videoWidth : 0.2;
  gestureRefs.current.scaleFactor = scaleFactor;
  const watermarkFontSize = Math.max(8, Math.round(videoHeight * 0.06 * scaleFactor));

  if (startTime === null) return null;
  if (contentRect.width === 0 || contentRect.height === 0) {
    return (
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        onLayout={onContainerLayout}
      />
    );
  }

  // --- Skia-preview gesture layer -------------------------------------------
  // When the Skia overlay owns the visuals, this component is a thin invisible
  // touch layer: drag/resize/pan/pinch hit areas + selection frame, positioned
  // from the bounds the Skia layer published. One geometry → frame glued to the
  // glyphs, no jump, preview == export.
  if (hideVisuals) {
    const showSummaryNow =
      isFinished && finishTime !== null && currentVideoTime - startTime >= finishTime + SUMMARY_DELAY_SECONDS;
    const pad = HANDLE_OVERLAP_PAD;

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onContainerLayout}>
        {(editing || summaryEditing) && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setEditing(false);
              setSummaryEditing(false);
            }}
          />
        )}

        {!showSummaryNow && timerPreviewBounds && (
          <View
            style={{
              position: "absolute",
              left: timerPreviewBounds.x,
              top: timerPreviewBounds.y - (editing ? pad : 0),
              width: timerPreviewBounds.width + (editing ? pad : 0),
              height: timerPreviewBounds.height + (editing ? pad : 0),
            }}
            pointerEvents="box-none"
          >
            <View
              {...timerPanResponder.panHandlers}
              style={{
                position: "absolute",
                left: 0,
                top: editing ? pad : 0,
                width: timerPreviewBounds.width,
                height: timerPreviewBounds.height,
                borderWidth: editing ? TIMER_EDIT_BORDER_WIDTH : 0,
                borderColor: editing ? TIMER_EDIT_BORDER_COLOR : "transparent",
              }}
            />
            {editing && (
              <View
                {...resizePanResponder.panHandlers}
                style={[styles.resizeHandle, { top: 0, right: 0 }]}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
              </View>
            )}
          </View>
        )}

        {showSummaryNow && summaryPreviewBounds && (
          <View
            style={{
              position: "absolute",
              left: summaryPreviewBounds.x,
              top: summaryPreviewBounds.y - (summaryEditing ? pad : 0),
              width: summaryPreviewBounds.width + (summaryEditing ? pad : 0),
              height: summaryPreviewBounds.height + (summaryEditing ? pad : 0),
            }}
            pointerEvents="box-none"
          >
            <View
              {...summaryPanResponder.panHandlers}
              style={{
                position: "absolute",
                left: 0,
                top: summaryEditing ? pad : 0,
                width: summaryPreviewBounds.width,
                height: summaryPreviewBounds.height,
                borderWidth: summaryEditing ? TIMER_EDIT_BORDER_WIDTH : 0,
                borderColor: summaryEditing ? TIMER_EDIT_BORDER_COLOR : "transparent",
                borderRadius: 8,
              }}
            />
            {summaryEditing && (
              <View
                {...summaryResizePanResponder.panHandlers}
                style={[styles.resizeHandle, { top: 0, right: 0 }]}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  const elapsed = isFinished && finishTime !== null ? Math.min(elapsedRaw, finishTime) : elapsedRaw;
  const timeText = formatTime(elapsed);

  const scaledFontSize = config.fontSize * scaleFactor;
  const scaledPadding = config.padding * scaleFactor;
  const scaledRadius = config.borderRadius * scaleFactor;

  const timerWrapperStyle = getTimerWrapperPixelStyle(
    config.position,
    config.anchor,
    contentRect.width,
    contentRect.height,
  );
  // Use measured-pixel positioning for the summary so its hit area lines up
  // with what's actually rendered. The percentage-based transform variant
  // (translateX/Y of -50%) leaves React Native's hit-testing pointing at the
  // pre-transform rect, so the resize handle at the visible top-right never
  // receives the touch.
  const summaryWrapperStyle = getMeasuredWrapperStyle(
    config.summaryPosition,
    config.summaryAnchor,
    contentRect.width,
    contentRect.height,
    summaryLayout,
  );

  const showSummary =
    isFinished &&
    finishTime !== null &&
    currentVideoTime - startTime >= finishTime + SUMMARY_DELAY_SECONDS;

  const splitFontSize = Math.max(8, Math.round(scaledFontSize * 0.55));
  const splitMemoFontSize = Math.max(7, Math.round(scaledFontSize * 0.38));
  const splitPadding = Math.max(3, Math.round(scaledPadding * 0.6));
  const splitGap = Math.max(2, Math.round(scaledPadding * 0.3));
  const splitRadius = Math.max(0, Math.round(scaledRadius * 0.6));
  const stackAlign = anchorAlignItems(config.anchor);

  // Padding so the resize handle lands inside the parent's hit-test bounds
  // (touches outside parent bounds aren't delivered to children on either
  // platform). Half the handle is allowed to overlap the inner box so the
  // handle visually anchors closer to the digits.
  const handlePadTop = editing ? HANDLE_OVERLAP_PAD : 0;
  const handlePadRight = editing ? HANDLE_OVERLAP_PAD : 0;
  const summaryHandlePadTop = summaryEditing ? HANDLE_OVERLAP_PAD : 0;
  const summaryHandlePadRight = summaryEditing ? HANDLE_OVERLAP_PAD : 0;

  const splitBadgeStyle = getSplitBadgePixelStyle(
    config.position,
    config.anchor,
    contentRect.width,
    contentRect.height,
    timerLayout,
    splitGap,
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onContainerLayout}>
      <View
        style={{
          position: "absolute",
          left: contentRect.x,
          top: contentRect.y,
          width: contentRect.width,
          height: contentRect.height,
        }}
        pointerEvents="box-none"
      >
        {/* Outside-tap dismiss for edit modes. Rendered before the timer/
            summary so taps that land on the timer/handle still hit those
            views first (deepest-child wins on the bubble phase). Only mounted
            while a mode is active so play/pause continues to work otherwise. */}
        {(editing || summaryEditing) && (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setEditing(false);
              setSummaryEditing(false);
            }}
          />
        )}

        {/* Watermark (Skia draws this when hideVisuals) */}
        {!hideVisuals && (
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
                fontFamily: "NotoSansJP-Bold",
              }}
            >
              SwimHub Timer
            </Text>
          </View>
        )}

        {!showSummary && (
          <View style={timerWrapperStyle} pointerEvents="box-none">
            <View
              {...timerPanResponder.panHandlers}
              style={{ alignItems: stackAlign }}
            >
              <View
                onLayout={onTimerLayout}
                style={{
                  paddingTop: handlePadTop,
                  paddingRight: handlePadRight,
                }}
              >
                <View
                  style={{
                    // While editing the timer we render the RN box (and its blue
                    // frame) so the frame stays glued to the glyphs; otherwise
                    // Skia draws the timer and the RN box is transparent.
                    backgroundColor: hideVisuals && !editing ? "transparent" : config.backgroundColor,
                    borderRadius: scaledRadius,
                    padding: scaledPadding,
                    borderWidth: editing ? TIMER_EDIT_BORDER_WIDTH : 0,
                    borderColor: editing ? TIMER_EDIT_BORDER_COLOR : "transparent",
                  }}
                >
                  <Text
                    style={{
                      color: hideVisuals && !editing ? "transparent" : config.textColor,
                      fontSize: scaledFontSize,
                      fontFamily:
                        config.fontFamily === "monospace" ? "NotoSansMono-Bold" : "NotoSansJP-Bold",
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {timeText}
                  </Text>
                </View>

                {editing && (
                  <View
                    {...resizePanResponder.panHandlers}
                    style={styles.resizeHandle}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Active split badge — rendered as an absolute sibling of the timer
            wrapper so its width is sized to its own content rather than being
            constrained (and word-wrapped) by the timer text width. */}
        {!hideVisuals && !showSummary && activeSplit && splitBadgeStyle && (
          <View style={splitBadgeStyle} pointerEvents="none">
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

        {showSummary && (
          <View
            style={summaryWrapperStyle}
            pointerEvents="box-none"
            testID="finish-summary-table"
            onLayout={onSummaryLayout}
          >
            <View {...summaryPanResponder.panHandlers}>
              <View
                style={{
                  paddingTop: summaryHandlePadTop,
                  paddingRight: summaryHandlePadRight,
                }}
              >
                <View
                  style={{
                    borderWidth: summaryEditing ? TIMER_EDIT_BORDER_WIDTH : 0,
                    borderColor: summaryEditing ? TIMER_EDIT_BORDER_COLOR : "transparent",
                    borderRadius: 8,
                  }}
                >
                  {/* opacity:0 (not unmounted) when hidden so onSummaryLayout
                      still measures the table → the drag/resize hit-area stays
                      correct while Skia draws the visible summary. While editing
                      the summary, show the RN table so its frame stays aligned. */}
                  <View style={hideVisuals && !summaryEditing ? { opacity: 0 } : undefined}>
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
                {summaryEditing && (
                  <View
                    {...summaryResizePanResponder.panHandlers}
                    style={styles.resizeHandle}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <Ionicons name="expand-outline" size={16} color="#FFFFFF" />
                  </View>
                )}
              </View>
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
  const fontFamily =
    config.fontFamily === "monospace" ? "NotoSansMono-Bold" : "NotoSansJP-Bold";

  return (
    <View
      style={{
        backgroundColor: config.backgroundColor,
        borderRadius: radius,
        padding,
        marginTop,
        marginBottom,
        alignSelf: "flex-start",
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: config.textColor,
          fontSize,
          fontFamily,
          fontVariant: ["tabular-nums"],
        }}
      >
        {headline}
      </Text>
      {split.memo ? (
        <Text
          numberOfLines={1}
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

const styles = StyleSheet.create({
  resizeHandle: {
    position: "absolute",
    top: 0,
    right: 0,
    width: RESIZE_HANDLE_SIZE,
    height: RESIZE_HANDLE_SIZE,
    borderRadius: RESIZE_HANDLE_SIZE / 2,
    backgroundColor: TIMER_EDIT_BORDER_COLOR,
    alignItems: "center",
    justifyContent: "center",
  },
});

export function getStopwatchWrapperStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
): ViewStyle {
  return getWrapperStyle(position, anchor);
}

// Measured-pixel wrapper. Falls back to the percentage variant on the first
// frame (before the wrapped view has been measured). Once we know its size we
// switch to absolute coords so React Native's hit-testing rectangle matches
// what the user sees — critical for non-bottom-left anchors that otherwise
// rely on a `transform: translate(-50%, -50%)`.
export function getMeasuredWrapperStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
  contentWidth: number,
  contentHeight: number,
  measured: { width: number; height: number } | null,
): ViewStyle {
  if (!measured) {
    return getTimerWrapperPixelStyle(position, anchor, contentWidth, contentHeight);
  }
  const xPx = position.x * contentWidth;
  const yPx = position.y * contentHeight;
  const base: ViewStyle = { position: "absolute" };
  const w = measured.width;
  const h = measured.height;
  switch (anchor) {
    case "top-left":
      return { ...base, left: xPx, top: yPx };
    case "top-center":
      return { ...base, left: xPx - w / 2, top: yPx };
    case "top-right":
      return { ...base, left: xPx - w, top: yPx };
    case "center":
      return { ...base, left: xPx - w / 2, top: yPx - h / 2 };
    case "bottom-left":
      return { ...base, left: xPx, top: yPx - h };
    case "bottom-center":
      return { ...base, left: xPx - w / 2, top: yPx - h };
    case "bottom-right":
      return { ...base, left: xPx - w, top: yPx - h };
    default:
      return { ...base, left: xPx, top: yPx };
  }
}

// Pixel-based wrapper for the live timer: avoids the percentage-based
// transform path, which intermittently failed to apply on first paint and
// left the timer clipped at the top-left of the screen.
function getTimerWrapperPixelStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
  contentWidth: number,
  contentHeight: number,
): ViewStyle {
  const base: ViewStyle = { position: "absolute" };
  const xPx = position.x * contentWidth;
  const yPx = position.y * contentHeight;

  switch (anchor) {
    case "top-left":
      return { ...base, left: xPx, top: yPx };
    case "top-center":
      return { ...base, left: 0, right: 0, top: yPx, flexDirection: "row", justifyContent: "center" };
    case "top-right":
      return { ...base, right: contentWidth - xPx, top: yPx };
    case "bottom-left":
      return { ...base, left: xPx, bottom: contentHeight - yPx };
    case "bottom-center":
      return {
        ...base,
        left: 0,
        right: 0,
        bottom: contentHeight - yPx,
        flexDirection: "row",
        justifyContent: "center",
      };
    case "bottom-right":
      return { ...base, right: contentWidth - xPx, bottom: contentHeight - yPx };
    case "center":
      return getWrapperStyle(position, anchor);
    default:
      return { ...base, left: xPx, top: yPx };
  }
}

// Position the split badge directly below the timer so it can render at
// content-width rather than being constrained (and wrapped) by the timer's
// width. For top-anchored configs we need the timer height to know where
// "below" is — fall back to no badge until the timer has been measured.
function getSplitBadgePixelStyle(
  position: { x: number; y: number },
  anchor: StopwatchAnchor,
  contentWidth: number,
  contentHeight: number,
  timerLayout: { width: number; height: number } | null,
  splitGap: number,
): ViewStyle | null {
  const xPx = position.x * contentWidth;
  const yPx = position.y * contentHeight;
  const base: ViewStyle = { position: "absolute" };

  switch (anchor) {
    case "bottom-left":
      return { ...base, left: xPx, top: yPx + splitGap };
    case "bottom-right":
      return { ...base, right: contentWidth - xPx, top: yPx + splitGap };
    case "bottom-center":
      return {
        ...base,
        left: 0,
        right: 0,
        top: yPx + splitGap,
        flexDirection: "row",
        justifyContent: "center",
      };
    case "top-left": {
      if (!timerLayout) return null;
      return { ...base, left: xPx, top: yPx + timerLayout.height + splitGap };
    }
    case "top-right": {
      if (!timerLayout) return null;
      return {
        ...base,
        right: contentWidth - xPx,
        top: yPx + timerLayout.height + splitGap,
      };
    }
    case "top-center": {
      if (!timerLayout) return null;
      return {
        ...base,
        left: 0,
        right: 0,
        top: yPx + timerLayout.height + splitGap,
        flexDirection: "row",
        justifyContent: "center",
      };
    }
    case "center": {
      if (!timerLayout) return null;
      return {
        ...base,
        left: 0,
        right: 0,
        top: yPx + timerLayout.height / 2 + splitGap,
        flexDirection: "row",
        justifyContent: "center",
      };
    }
    default:
      return { ...base, left: xPx, top: yPx + splitGap };
  }
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
