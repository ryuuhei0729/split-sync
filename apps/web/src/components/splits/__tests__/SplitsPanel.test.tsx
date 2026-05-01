/**
 * Sprint Contract テスト — Phase B 実装済み
 * 対象: apps/web/src/components/splits/SplitsPanel.tsx
 *
 * 検証対象の Sprint Contract 項目:
 *   V-01: raceDistance 未選択時 Finish ボタンが disabled
 *   V-02: raceDistance 未選択時 Finish ボタンのラベルが "Select race distance"
 *   V-03: raceDistance=100 選択時 Finish ボタンが enabled
 *   V-04: raceDistance=100 選択時 Finish ボタンのラベルが "Finish (100m)"
 *   V-05: 距離チップをクリックすると raceDistance がトグルする
 *   V-19: isFinished=true 時に Edit ボタンが表示される
 *   V-20: Edit ボタンクリックで revertFinish が呼ばれる
 *   V-21: isFinished=false 時に Edit ボタンが表示されない
 *   V-22: startTime=null 時は race distance チップ行が表示されない
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SplitsPanel } from "../SplitsPanel";
import * as editorStore from "@/stores/editor-store";
import * as authHook from "@/hooks/useAuth";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

// テスト用 i18n インスタンス (英語キー)
const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: {
    en: {
      translation: {
        "splits.title": "Splits",
        "splits.record": "Record",
        "splits.finish": "Finish",
        "splits.finishAtDistance": "Finish ({{distance}}m)",
        "splits.finishNeedRaceDistance": "Select race distance",
        "splits.raceDistanceLabel": "Race distance",
        "splits.edit": "Edit",
        "splits.finalTime": "Final Time",
        "splits.distancePlaceholder": "Distance (m)",
        "splits.memoPlaceholder": "Memo (optional)",
        "splits.emptyHint": "Pause the video, enter distance,\nand tap Record to log a split",
        "splits.lap": "lap",
        "splits.limitReached": "Split limit ({{max}}) reached.",
        "common.reset": "Reset",
      },
    },
  },
  interpolation: { escapeValue: false },
});

// useAuth の共通モック
const mockAuth = () => {
  vi.spyOn(authHook, "useAuth").mockReturnValue({
    user: null,
    loading: false,
    plan: "free",
    subscription: null,
    subscriptionStatus: null,
    signOut: vi.fn(),
    refreshSubscription: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
  });
};

// useEditorStore モック用の状態型
type StoreMock = Partial<ReturnType<typeof editorStore.useEditorStore>>;

const mockSetRaceDistance = vi.fn();
const mockFinishRecording = vi.fn();
const mockRevertFinish = vi.fn();
const mockResetSplits = vi.fn();
const mockRecordSplit = vi.fn();
const mockRemoveSplit = vi.fn();
const mockSeekVideo = vi.fn();
const mockSetCurrentDistanceInput = vi.fn();
const mockSetCurrentMemoInput = vi.fn();

const defaultStoreState: StoreMock = {
  splitTimes: [],
  isFinished: false,
  finishTime: null,
  finishMemo: "",
  startTime: 5.0,
  currentVideoTime: 30.0,
  currentDistanceInput: "",
  currentMemoInput: "",
  raceDistance: null,
  setCurrentDistanceInput: mockSetCurrentDistanceInput,
  setCurrentMemoInput: mockSetCurrentMemoInput,
  setRaceDistance: mockSetRaceDistance,
  recordSplit: mockRecordSplit,
  finishRecording: mockFinishRecording,
  removeSplit: mockRemoveSplit,
  revertFinish: mockRevertFinish,
  resetSplits: mockResetSplits,
  seekVideo: mockSeekVideo,
};

function mockStore(overrides: StoreMock = {}) {
  // useEditorStore は selector 関数を受け取るオーバーロードと state を直接返すものが混在するため
  // 実際の呼び出しパターン (selector なし) に対応したモックを実装する
  const state = { ...defaultStoreState, ...overrides };
  vi.spyOn(editorStore, "useEditorStore").mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selector?: any) => (selector ? selector(state) : state) as any,
  );
}

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <SplitsPanel />
    </I18nextProvider>,
  );
}

describe("SplitsPanel — race distance UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it("[V-01] raceDistance=null のとき Finish ボタンが disabled", () => {
    mockStore({ raceDistance: null });
    renderPanel();
    const finishBtn = screen.getByRole("button", { name: /Select race distance/i });
    expect(finishBtn).toBeDisabled();
  });

  it('[V-02] raceDistance=null のとき Finish ボタンのラベルが "Select race distance"', () => {
    mockStore({ raceDistance: null });
    renderPanel();
    expect(screen.getByText("Select race distance")).toBeInTheDocument();
  });

  it("[V-03] raceDistance=100 のとき Finish ボタンが enabled (disabled でない)", () => {
    mockStore({ raceDistance: 100 });
    renderPanel();
    const finishBtn = screen.getByRole("button", { name: /Finish \(100m\)/i });
    expect(finishBtn).not.toBeDisabled();
  });

  it('[V-04] raceDistance=100 のとき Finish ボタンのラベルが "Finish (100m)"', () => {
    mockStore({ raceDistance: 100 });
    renderPanel();
    expect(screen.getByText("Finish (100m)")).toBeInTheDocument();
  });

  it('[V-05] 距離チップ "100m" をクリックすると setRaceDistance(100) が呼ばれる', () => {
    mockStore({ raceDistance: null });
    renderPanel();
    const chip = screen.getByRole("button", { name: "100m" });
    fireEvent.click(chip);
    expect(mockSetRaceDistance).toHaveBeenCalledWith(100);
  });

  it("[V-05] アクティブな距離チップを再クリックすると setRaceDistance(null) が呼ばれる (トグル)", () => {
    mockStore({ raceDistance: 100 });
    renderPanel();
    const chip = screen.getByRole("button", { name: "100m" });
    fireEvent.click(chip);
    // raceDistance === d のとき null を渡すトグル動作
    expect(mockSetRaceDistance).toHaveBeenCalledWith(null);
  });

  it("[V-22] startTime=null のとき race distance チップ行が DOM に存在しない", () => {
    mockStore({ startTime: null });
    renderPanel();
    // "Race distance" ラベルが存在しない
    expect(screen.queryByText("Race distance")).not.toBeInTheDocument();
  });

  it("[V-22] isFinished=true のとき race distance チップ行が DOM に存在しない", () => {
    mockStore({ startTime: 5.0, isFinished: true, finishTime: 65.0, raceDistance: 100 });
    renderPanel();
    // isFinished=true のとき チップ行は非表示 (startTime !== null && !isFinished の条件)
    expect(screen.queryByText("Race distance")).not.toBeInTheDocument();
  });

  it("COMMON_RACE_DISTANCES の全距離チップ (25m, 50m, 100m, 200m, 400m, 800m, 1500m) が表示される", () => {
    mockStore({ raceDistance: null, startTime: 5.0 });
    renderPanel();
    // startTime あり かつ isFinished=false のとき全チップが表示される
    for (const dist of [25, 50, 100, 200, 400, 800, 1500]) {
      expect(screen.getByRole("button", { name: `${dist}m` })).toBeInTheDocument();
    }
  });
});

describe("SplitsPanel — Edit button (revertFinish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it("[V-19] isFinished=true かつ finishTime あり のとき Edit ボタンが表示される", () => {
    mockStore({ isFinished: true, finishTime: 65.0 });
    renderPanel();
    expect(screen.getByRole("button", { name: /Edit/i })).toBeInTheDocument();
  });

  it("[V-20] Edit ボタンをクリックすると revertFinish が呼ばれる", () => {
    mockStore({ isFinished: true, finishTime: 65.0 });
    renderPanel();
    const editBtn = screen.getByRole("button", { name: /Edit/i });
    fireEvent.click(editBtn);
    expect(mockRevertFinish).toHaveBeenCalledTimes(1);
  });

  it("[V-21] isFinished=false のとき Edit ボタンが表示されない", () => {
    mockStore({ isFinished: false, finishTime: null, startTime: 5.0 });
    renderPanel();
    expect(screen.queryByRole("button", { name: /Edit/i })).not.toBeInTheDocument();
  });

  it("[V-21] startTime=null のとき Edit ボタンが表示されない (録画前の状態)", () => {
    mockStore({ isFinished: false, finishTime: null, startTime: null });
    renderPanel();
    expect(screen.queryByRole("button", { name: /Edit/i })).not.toBeInTheDocument();
  });
});
