import { useRef, useCallback, useEffect, useState } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { Ionicons } from "@expo/vector-icons";
import { useEditorStore } from "../../stores/editor-store";
import { StopwatchOverlay } from "../stopwatch/StopwatchOverlay";
import { StopwatchSkiaOverlay } from "../stopwatch/StopwatchSkiaOverlay";
import { colors, spacing, radius, fontSize } from "../../lib/theme";
import { formatTime } from "@swimhub-timer/shared";

// Phase 3 (design-skia-unified-renderer.md §4.1): draw the overlay preview with
// Skia so it's pixel-identical to the export. StopwatchSkiaOverlay renders the
// WYSIWYG pixels (pointerEvents="none"); StopwatchOverlay sits on top with its
// visible chrome hidden, providing only drag/resize/tap gestures + handles.
// Requires a Skia-enabled native build (won't work in Expo Go).
const USE_SKIA_PREVIEW = true;

export function VideoPlayer() {
  const videoUri = useEditorStore((s) => s.videoUri);
  const videoMetadata = useEditorStore((s) => s.videoMetadata);
  const setCurrentVideoTime = useEditorStore((s) => s.setCurrentVideoTime);
  const currentVideoTime = useEditorStore((s) => s.currentVideoTime);
  const pendingVideoSeek = useEditorStore((s) => s.pendingVideoSeek);
  const clearPendingSeek = useEditorStore((s) => s.clearPendingSeek);
  const [isPlaying, setIsPlaying] = useState(false);

  const player = useVideoPlayer(videoUri ?? "", (p) => {
    p.loop = false;
    p.muted = false;
  });

  // Sync playback time to store
  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      setCurrentVideoTime(player.currentTime);
    }, 50);
    return () => clearInterval(interval);
  }, [player, setCurrentVideoTime]);

  // Handle pending seeks (with optional pause)
  useEffect(() => {
    if (pendingVideoSeek !== null && player) {
      const shouldPause = useEditorStore.getState().pendingPause;
      player.currentTime = pendingVideoSeek;
      if (shouldPause) {
        player.pause();
      }
      clearPendingSeek();
    }
  }, [pendingVideoSeek, player, clearPendingSeek]);

  // Sync playing state
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener("playingChange", (event) => {
      setIsPlaying(event.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [player, isPlaying]);

  const duration = videoMetadata?.duration ?? 0;
  const progress = duration > 0 ? currentVideoTime / duration : 0;
  const seekBarWidth = useRef(0);

  const seekToPosition = useCallback(
    (locationX: number) => {
      if (!player || duration <= 0 || seekBarWidth.current <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / seekBarWidth.current));
      const targetTime = ratio * duration;
      player.currentTime = targetTime;
      setCurrentVideoTime(targetTime);
    },
    [player, duration, setCurrentVideoTime],
  );

  return (
    <View style={styles.container}>
      {/* Video + Overlay (tap to toggle play/pause) */}
      <Pressable style={styles.videoWrapper} onPress={togglePlay}>
        {player && (
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            // Android's default SurfaceView ignores z-order/overflow/borderRadius and
            // punches through the Skia/gesture overlays below it. textureView avoids
            // that; no-op on iOS.
            surfaceType="textureView"
          />
        )}
        {/* Skia visuals underneath (read-only) ... */}
        {USE_SKIA_PREVIEW && (
          <StopwatchSkiaOverlay
            videoWidth={videoMetadata?.width || 1920}
            videoHeight={videoMetadata?.height || 1080}
          />
        )}
        {/* ... RN gesture/handle layer on top (chrome hidden when Skia is active) */}
        <StopwatchOverlay
          videoWidth={videoMetadata?.width || 1920}
          videoHeight={videoMetadata?.height || 1080}
          hideVisuals={USE_SKIA_PREVIEW}
        />
      </Pressable>

      {/* Controls: [Play] [SeekBar] [Time] */}
      <View style={styles.controls}>
        <Pressable style={styles.playBtn} onPress={togglePlay}>
          <Ionicons name={isPlaying ? "pause" : "play"} size={18} color={colors.muted} />
        </Pressable>

        <View
          style={styles.seekBarContainer}
          onLayout={(e) => {
            seekBarWidth.current = e.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => {
            seekToPosition(e.nativeEvent.locationX);
          }}
          onResponderMove={(e) => {
            seekToPosition(e.nativeEvent.locationX);
          }}
          onResponderRelease={() => {}}
        >
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <View style={styles.seekBarInner}>
              <View style={styles.seekBarBg}>
                <View style={[styles.seekBarFill, { width: `${progress * 100}%` }]} />
              </View>
              <View style={[styles.seekThumb, { left: `${progress * 100}%` }]} />
            </View>
          </View>
        </View>

        <Text style={styles.timeText}>
          {formatTime(currentVideoTime)} / {formatTime(duration)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  videoWrapper: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  playBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  seekBarContainer: {
    flex: 1,
    height: 20,
    justifyContent: "center",
  },
  seekBarInner: {
    flex: 1,
    justifyContent: "center",
  },
  seekBarBg: {
    height: 3,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 2,
    overflow: "hidden",
  },
  seekBarFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  seekThumb: {
    position: "absolute",
    top: 5,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginLeft: -6,
  },
  timeText: {
    fontSize: fontSize.xs,
    fontFamily: "monospace",
    color: colors.muted,
  },
});
