/**
 * Lap-Time 計算ユーティリティ
 * swim-hub の `apps/web/utils/lapTimeCalculator.ts` と同じアルゴリズムを mobile / web で共有する。
 */

export interface RaceSplitTime {
  distance: number;
  splitTime: number;
}

/**
 * 種目距離に応じた lap 間隔を返す。
 * 種目距離と一致する間隔は除外（例: 50m race の 50m lap は意味を持たない）。
 * 1500m は特例で 100m まで。
 */
export function getLapIntervalsForRace(raceDistance: number): number[] {
  if (raceDistance === 1500) return [25, 50, 100];

  const intervals: number[] = [];
  if (raceDistance >= 25 && raceDistance !== 25) intervals.push(25);
  if (raceDistance >= 50 && raceDistance !== 50) intervals.push(50);
  if (raceDistance >= 100 && raceDistance !== 100) intervals.push(100);
  if (raceDistance >= 200 && raceDistance !== 200) intervals.push(200);
  if (raceDistance >= 400 && raceDistance !== 400) intervals.push(400);
  return intervals;
}

export interface RaceLapRow {
  distance: number;
  splitTime: number | null;
  lapTimes: Record<number, number | null>;
}

/**
 * 種目距離に応じた多列 lap-time テーブルを生成する。
 * - 25m の倍数の split のみを行に採用
 * - 各 interval 列は、対応する距離が interval の倍数のときだけ値を入れる（それ以外は null）
 */
export function calculateRaceLapTimesTable(
  splitTimes: RaceSplitTime[],
  raceDistance: number,
): RaceLapRow[] {
  if (splitTimes.length === 0) return [];

  const intervals = getLapIntervalsForRace(raceDistance);
  const sorted = [...splitTimes].sort((a, b) => a.distance - b.distance);
  const filtered = sorted.filter((s) => s.distance % 25 === 0 && s.splitTime > 0);

  const rows: RaceLapRow[] = [];
  for (const split of filtered) {
    const lapTimes: Record<number, number | null> = {};
    for (const interval of intervals) {
      if (split.distance % interval !== 0) {
        lapTimes[interval] = null;
        continue;
      }
      if (split.distance === interval) {
        lapTimes[interval] = split.splitTime;
        continue;
      }
      const prevDistance = split.distance - interval;
      const prevSplit = filtered.find((st) => st.distance === prevDistance);
      if (prevSplit && prevSplit.splitTime > 0) {
        lapTimes[interval] = split.splitTime - prevSplit.splitTime;
      } else if (prevDistance === 0) {
        lapTimes[interval] = split.splitTime;
      } else {
        lapTimes[interval] = null;
      }
    }
    rows.push({ distance: split.distance, splitTime: split.splitTime, lapTimes });
  }
  return rows;
}

/**
 * 与えられた race distance に対して、`raceLapTimesTable` の中で実際に値を持つ interval 列だけを返す。
 * UI 上、データのない列は非表示にするための補助。
 */
export function getVisibleLapIntervals(
  rows: RaceLapRow[],
  raceDistance: number,
): number[] {
  const intervals = getLapIntervalsForRace(raceDistance);
  return intervals.filter((interval) => rows.some((row) => row.lapTimes[interval] != null));
}

export const COMMON_RACE_DISTANCES = [25, 50, 100, 200, 400, 800, 1500] as const;
export type CommonRaceDistance = (typeof COMMON_RACE_DISTANCES)[number];
