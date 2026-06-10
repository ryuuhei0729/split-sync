import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { SplitTime, StopwatchConfig } from "@swimhub-timer/shared";
import {
  formatTime,
  calculateRaceLapTimesTable,
  getVisibleLapIntervals,
} from "@swimhub-timer/shared";

export interface FinishSummaryTableProps {
  splitTimes: SplitTime[];
  finishTime: number;
  config: Pick<StopwatchConfig, "textColor" | "backgroundColor" | "fontFamily">;
  scaleFactor: number;
  raceDistance: number | null;
}

export function FinishSummaryTable({
  splitTimes,
  finishTime,
  config,
  scaleFactor,
  raceDistance,
}: FinishSummaryTableProps) {
  const { t } = useTranslation();

  const baseFontSize = Math.max(8, Math.round(13 * scaleFactor));
  const headerFontSize = Math.max(7, Math.round(10 * scaleFactor));
  const cellPadV = Math.max(2, Math.round(4 * scaleFactor));
  const cellPadH = Math.max(2, Math.round(6 * scaleFactor));
  const containerPad = Math.max(4, Math.round(10 * scaleFactor));
  const borderRadius = Math.max(4, Math.round(8 * scaleFactor));
  const cellDistWidth = Math.max(28, Math.round(56 * scaleFactor));
  const cellSplitWidth = Math.max(48, Math.round(90 * scaleFactor));
  const cellLapWidth = Math.max(32, Math.round(64 * scaleFactor));

  // Use system fonts here (not the bundled NotoSans-Bold). The off-screen view
  // for export captureRef must render reliably even before Font.loadAsync has
  // finished, and we previously saw the summary disappear from exported
  // videos when the captured view depended on a not-yet-loaded font.
  const textStyle = {
    color: config.textColor,
    fontFamily: config.fontFamily === "monospace" ? "monospace" : undefined,
    fontVariant: ["tabular-nums"] as ["tabular-nums"],
  };

  // Multi-interval rows. When raceDistance is unset, fall back to a degenerate
  // single-column "lap = delta from previous 25m" view by treating raceDistance
  // as the largest split distance present.
  const sortedSplits = [...splitTimes].sort((a, b) => a.distance - b.distance);
  const effectiveRace =
    raceDistance ?? (sortedSplits.length > 0 ? sortedSplits[sortedSplits.length - 1].distance : 0);
  const raceRows = effectiveRace > 0
    ? calculateRaceLapTimesTable(
        sortedSplits.map((s) => ({ distance: s.distance, splitTime: s.time })),
        effectiveRace,
      )
    : [];
  const intervals = effectiveRace > 0 ? getVisibleLapIntervals(raceRows, effectiveRace) : [];

  const showFinalRow = !raceRows.some((r) => r.distance === effectiveRace);

  return (
    <View
      testID="summary-container"
      style={[
        styles.container,
        {
          backgroundColor: config.backgroundColor,
          borderRadius,
          padding: containerPad,
        },
      ]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <Text
          testID="summary-text"
          style={[
            styles.cellDist,
            textStyle,
            { width: cellDistWidth, fontSize: headerFontSize, opacity: 0.7 },
          ]}
        >
          {t("splits.distanceHeader").toUpperCase()}
        </Text>
        <Text
          style={[
            styles.cellSplit,
            textStyle,
            { width: cellSplitWidth, fontSize: headerFontSize, opacity: 0.7 },
          ]}
        >
          {t("splits.overlay.splitTime")}
        </Text>
        {intervals.map((interval) => (
          <Text
            key={interval}
            style={[
              styles.cellLap,
              textStyle,
              { width: cellLapWidth, fontSize: headerFontSize, opacity: 0.7 },
            ]}
          >
            {`${interval}M`}
          </Text>
        ))}
      </View>

      {/* Race rows */}
      {raceRows.map((row) => (
        <View key={row.distance} style={[styles.row, { paddingVertical: cellPadV }]}>
          <Text
            style={[
              styles.cellDist,
              textStyle,
              { width: cellDistWidth, fontSize: baseFontSize, fontWeight: "700", paddingHorizontal: cellPadH },
            ]}
          >
            {row.distance}m
          </Text>
          <Text
            style={[
              styles.cellSplit,
              textStyle,
              { width: cellSplitWidth, fontSize: baseFontSize, paddingHorizontal: cellPadH },
            ]}
          >
            {row.splitTime !== null ? formatTime(row.splitTime) : "-"}
          </Text>
          {intervals.map((interval) => {
            const lap = row.lapTimes[interval];
            return (
              <Text
                key={interval}
                style={[
                  styles.cellLap,
                  textStyle,
                  { width: cellLapWidth, fontSize: baseFontSize, paddingHorizontal: cellPadH },
                ]}
              >
                {lap !== null && lap !== undefined ? formatTime(lap) : "-"}
              </Text>
            );
          })}
        </View>
      ))}

      {/* Final time row — only when no row covered raceDistance */}
      {showFinalRow && (
        <View
          style={[
            styles.row,
            styles.finishRow,
            {
              paddingVertical: cellPadV,
              borderRadius: Math.max(2, Math.round(4 * scaleFactor)),
              marginTop: Math.max(2, Math.round(3 * scaleFactor)),
            },
          ]}
        >
          <Text
            style={[
              styles.cellDist,
              textStyle,
              { width: cellDistWidth, fontSize: baseFontSize, fontWeight: "700", paddingHorizontal: cellPadH },
            ]}
          >
            {effectiveRace > 0 ? `${effectiveRace}m` : t("splits.finalTime")}
          </Text>
          <Text
            style={[
              styles.cellSplit,
              textStyle,
              { width: cellSplitWidth, fontSize: baseFontSize, fontWeight: "700", paddingHorizontal: cellPadH },
            ]}
          >
            {formatTime(finishTime)}
          </Text>
          {intervals.map((interval) => (
            <Text
              key={interval}
              style={[
                styles.cellLap,
                textStyle,
                { width: cellLapWidth, fontSize: baseFontSize, paddingHorizontal: cellPadH },
              ]}
            >
              -
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "flex-start",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  finishRow: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  cellDist: {},
  cellSplit: {},
  cellLap: {
    textAlign: "center",
  },
});
