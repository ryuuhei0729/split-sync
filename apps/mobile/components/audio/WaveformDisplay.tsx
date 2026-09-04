import { useRef, useCallback } from "react";
import { View, StyleSheet, type LayoutChangeEvent } from "react-native";
import { colors, radius } from "../../lib/theme";

interface Props {
  waveformData: Float32Array;
  duration: number;
  signalTime: number;
  currentTime: number;
  onSeek?: (time: number) => void;
}

const BAR_HEIGHT = 90;

export function WaveformDisplay({
  waveformData,
  duration,
  signalTime,
  currentTime,
  onSeek,
}: Props) {
  const barCount = waveformData.length;
  const signalPercent = duration > 0 && signalTime >= 0 ? (signalTime / duration) * 100 : -10;

  const containerWidth = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    containerWidth.current = e.nativeEvent.layout.width;
  }, []);

  const seekToX = useCallback(
    (locationX: number) => {
      if (!onSeek || containerWidth.current <= 0 || duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / containerWidth.current));
      onSeek(ratio * duration);
    },
    [onSeek, duration],
  );

  return (
    <View
      testID="signal-waveform"
      style={styles.container}
      onLayout={onLayout}
      onStartShouldSetResponder={() => !!onSeek}
      onMoveShouldSetResponder={() => !!onSeek}
      onResponderGrant={(e) => seekToX(e.nativeEvent.locationX)}
      onResponderMove={(e) => seekToX(e.nativeEvent.locationX)}
    >
      <View style={styles.barsContainer}>
        {Array.from({ length: barCount }, (_, i) => {
          const amplitude = waveformData[i];
          if (amplitude === undefined) return null; // barCount === waveformData.length, so i is
                                                       // always in-bounds; guard is defensive only
          const barHeight = Math.max(2, amplitude * BAR_HEIGHT * 0.9);
          const opacity = 0.15 + amplitude * 0.6;

          return (
            <View
              key={i}
              style={{
                flex: 1,
                height: barHeight,
                backgroundColor: colors.primary,
                opacity,
                marginHorizontal: 0.5,
                borderRadius: 1,
              }}
            />
          );
        })}
      </View>

      {/* Signal marker (red line) - pointerEvents="none" so taps pass through to container */}
      {signalTime >= 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[styles.signalGlow, { left: `${signalPercent}%` }]} />
          <View style={[styles.signalMarker, { left: `${signalPercent}%` }]} />
          <View style={[styles.signalTriangle, { left: `${signalPercent}%` }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: BAR_HEIGHT,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    position: "relative",
  },
  barsContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  signalGlow: {
    position: "absolute",
    top: 0,
    width: 6,
    height: BAR_HEIGHT,
    backgroundColor: "rgba(220, 38, 38, 0.3)",
    marginLeft: -3,
  },
  signalMarker: {
    position: "absolute",
    top: 0,
    width: 2,
    height: BAR_HEIGHT,
    backgroundColor: colors.destructive,
    marginLeft: -1,
  },
  signalTriangle: {
    position: "absolute",
    top: 0,
    width: 0,
    height: 0,
    marginLeft: -5,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: colors.destructive,
  },
});
