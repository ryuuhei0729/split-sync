/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/stores/editor-store.ts
 *
 * 検証対象の Sprint Contract 項目:
 *   V-06: raceDistance チップで Finish ボタン enable/disable (store 側: canFinish ロジック)
 *   V-07: setRaceDistance で raceDistance が更新される
 *   V-08: finishRecording で auto-split が raceDistance の距離に追加される
 *   V-09: finishRecording — 既存の raceDistance split を上書き (duplicate 排除)
 *   V-10: finishRecording — raceDistance=null のとき auto-split なし
 *   V-11: revertFinish — auto-added split が削除され isFinished=false に戻る
 *   V-12: revertFinish — ユーザーが手動で同距離に登録した split (time != finishTime) は保持
 *   V-13: resetSplits — raceDistance が null にリセットされる
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "../editor-store";

function getStore() {
  return useEditorStore.getState();
}

function resetStore() {
  useEditorStore.setState({
    splitTimes: [],
    currentDistanceInput: "",
    currentMemoInput: "",
    raceDistance: null,
    isFinished: false,
    finishTime: null,
    finishMemo: "",
    startTime: null,
    currentVideoTime: 0,
    pendingVideoSeek: null,
  });
}

describe("editor-store — raceDistance", () => {
  beforeEach(() => {
    resetStore();
  });

  it("[V-07] setRaceDistance(100) で raceDistance が 100 に更新される", () => {
    getStore().setRaceDistance(100);
    expect(getStore().raceDistance).toBe(100);
  });

  it("[V-07] setRaceDistance(null) で raceDistance が null にクリアされる", () => {
    getStore().setRaceDistance(200);
    getStore().setRaceDistance(null);
    expect(getStore().raceDistance).toBeNull();
  });

  it("[V-06] raceDistance が null のとき canFinish ロジックが false になる (raceDistance=null は falsy)", () => {
    // SplitsPanel の canFinish は `raceDistance !== null && raceDistance > 0`
    // store 側の値が null であることを確認して UI 側の判断根拠を検証する
    const { raceDistance } = getStore();
    expect(raceDistance).toBeNull();
    expect(raceDistance !== null && raceDistance > 0).toBe(false);
  });

  it("[V-06] raceDistance が 100 のとき canFinish ロジックが true になる", () => {
    getStore().setRaceDistance(100);
    const { raceDistance } = getStore();
    expect(raceDistance !== null && raceDistance > 0).toBe(true);
  });
});

describe("editor-store — finishRecording with raceDistance", () => {
  beforeEach(() => {
    resetStore();
  });

  it("[V-08] raceDistance=100, finishTime=65 のとき splitTimes に distance=100 の split が追加される", () => {
    getStore().setRaceDistance(100);
    getStore().finishRecording(65.0);
    const { splitTimes } = getStore();
    const autoSplit = splitTimes.find((s) => s.distance === 100);
    expect(autoSplit).toBeDefined();
  });

  it("[V-08] 追加された auto-split の time は finishRecording に渡した elapsedSeconds と一致する", () => {
    getStore().setRaceDistance(100);
    getStore().finishRecording(65.42);
    const { splitTimes } = getStore();
    const autoSplit = splitTimes.find((s) => s.distance === 100);
    expect(autoSplit?.time).toBe(65.42);
  });

  it("[V-09] raceDistance=100 の split が既に存在する場合、finishRecording で上書きされる (重複なし)", () => {
    // まず手動で 100m split を入れる
    useEditorStore.setState({
      splitTimes: [{ distance: 100, time: 60.0, lapTime: null, memo: "" }],
      raceDistance: 100,
    });
    getStore().finishRecording(65.0);
    const { splitTimes } = getStore();
    const hundredSplits = splitTimes.filter((s) => s.distance === 100);
    // 重複がなく1件のみ
    expect(hundredSplits).toHaveLength(1);
    // finishRecording の値で上書きされている
    // toHaveLength(1) above already proves hundredSplits[0] exists.
    expect(hundredSplits[0]!.time).toBe(65.0);
  });

  it("[V-10] raceDistance=null のとき finishRecording を呼んでも splitTimes に変化なし", () => {
    useEditorStore.setState({
      splitTimes: [{ distance: 50, time: 30.0, lapTime: null, memo: "" }],
      raceDistance: null,
    });
    const before = getStore().splitTimes.length;
    getStore().finishRecording(60.0);
    expect(getStore().splitTimes).toHaveLength(before);
  });

  it("[V-10] raceDistance=0 のとき finishRecording を呼んでも auto-split は追加されない", () => {
    useEditorStore.setState({
      splitTimes: [],
      raceDistance: 0,
    });
    getStore().finishRecording(60.0);
    // raceDistance=0 は条件 raceDistance > 0 を満たさないので auto-split は追加されない
    expect(getStore().splitTimes).toHaveLength(0);
  });

  it("[V-08] finishRecording 後 isFinished=true, finishTime に elapsedSeconds がセットされる", () => {
    getStore().setRaceDistance(100);
    getStore().finishRecording(72.55);
    const { isFinished, finishTime } = getStore();
    expect(isFinished).toBe(true);
    expect(finishTime).toBe(72.55);
  });

  it("[V-08] auto-split は距離順にソートされて挿入される", () => {
    // 50m split を先に入れてから raceDistance=100 で finish
    useEditorStore.setState({
      splitTimes: [{ distance: 50, time: 30.0, lapTime: null, memo: "" }],
      raceDistance: 100,
    });
    getStore().finishRecording(65.0);
    const { splitTimes } = getStore();
    // 距離が昇順であることを確認
    for (let i = 1; i < splitTimes.length; i++) {
      expect(splitTimes[i]!.distance).toBeGreaterThan(splitTimes[i - 1]!.distance);
    }
    expect(splitTimes[0]!.distance).toBe(50);
    expect(splitTimes[1]!.distance).toBe(100);
  });
});

describe("editor-store — revertFinish", () => {
  beforeEach(() => {
    resetStore();
  });

  it("[V-11] revertFinish で isFinished が false に戻る", () => {
    useEditorStore.setState({
      raceDistance: 100,
      splitTimes: [{ distance: 100, time: 65.0, lapTime: null, memo: "" }],
      isFinished: true,
      finishTime: 65.0,
      finishMemo: "",
    });
    getStore().revertFinish();
    expect(getStore().isFinished).toBe(false);
  });

  it("[V-11] revertFinish で finishTime が null に戻る", () => {
    useEditorStore.setState({
      raceDistance: 100,
      splitTimes: [{ distance: 100, time: 65.0, lapTime: null, memo: "" }],
      isFinished: true,
      finishTime: 65.0,
      finishMemo: "",
    });
    getStore().revertFinish();
    expect(getStore().finishTime).toBeNull();
  });

  it("[V-11] revertFinish で auto-added split (distance=raceDistance, time=finishTime) が削除される", () => {
    // finishRecording で自動追加された split が revertFinish で取り除かれる
    useEditorStore.setState({
      raceDistance: 100,
      splitTimes: [{ distance: 100, time: 65.0, lapTime: null, memo: "" }],
      isFinished: true,
      finishTime: 65.0,
      finishMemo: "",
    });
    getStore().revertFinish();
    const { splitTimes } = getStore();
    // distance=100, time=65.0 の split は削除されているはず
    expect(splitTimes.find((s) => s.distance === 100 && s.time === 65.0)).toBeUndefined();
  });

  it("[V-12] ユーザーが手動で raceDistance と同距離に登録した split で time != finishTime の場合は削除されない", () => {
    // 手動で distance=100, time=60.0 を登録。finishTime は 65.0 で異なる
    useEditorStore.setState({
      raceDistance: 100,
      splitTimes: [{ distance: 100, time: 60.0, lapTime: null, memo: "manual" }],
      isFinished: true,
      finishTime: 65.0,
      finishMemo: "",
    });
    getStore().revertFinish();
    const { splitTimes } = getStore();
    // time が finishTime(65.0) と異なる手動 split は残る
    expect(splitTimes.find((s) => s.distance === 100 && s.time === 60.0)).toBeDefined();
  });

  it("[V-11] revertFinish — raceDistance=null のとき splitTimes は変化しない", () => {
    useEditorStore.setState({
      raceDistance: null,
      splitTimes: [{ distance: 50, time: 30.0, lapTime: null, memo: "" }],
      isFinished: true,
      finishTime: 30.0,
      finishMemo: "",
    });
    getStore().revertFinish();
    // raceDistance=null なので自動削除する対象がない → splitTimes は変わらない
    expect(getStore().splitTimes).toHaveLength(1);
  });

  it("[V-11] revertFinish 後に再度 finishRecording を呼べる (二重往復)", () => {
    useEditorStore.setState({ raceDistance: 100, splitTimes: [], isFinished: false, finishTime: null });
    // 1回目
    getStore().finishRecording(65.0);
    expect(getStore().isFinished).toBe(true);
    // revert
    getStore().revertFinish();
    expect(getStore().isFinished).toBe(false);
    // 2回目
    getStore().finishRecording(66.0);
    expect(getStore().isFinished).toBe(true);
    expect(getStore().finishTime).toBe(66.0);
  });
});

describe("editor-store — resetSplits", () => {
  it("[V-13] resetSplits で raceDistance が null にリセットされる", () => {
    useEditorStore.setState({ raceDistance: 100 });
    getStore().resetSplits();
    expect(getStore().raceDistance).toBeNull();
  });

  it("[V-13] resetSplits で splitTimes が空配列になる", () => {
    useEditorStore.setState({
      splitTimes: [
        { distance: 50, time: 30.0, lapTime: null, memo: "" },
        { distance: 100, time: 65.0, lapTime: null, memo: "" },
      ],
    });
    getStore().resetSplits();
    expect(getStore().splitTimes).toHaveLength(0);
  });

  it("[V-13] resetSplits で isFinished が false になる", () => {
    useEditorStore.setState({ isFinished: true, finishTime: 65.0 });
    getStore().resetSplits();
    expect(getStore().isFinished).toBe(false);
    expect(getStore().finishTime).toBeNull();
  });
});
