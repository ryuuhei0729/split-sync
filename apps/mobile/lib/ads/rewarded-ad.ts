import { Platform } from "react-native";

function getAdModule() {
  try {
    return require("react-native-google-mobile-ads");
  } catch {
    return null;
  }
}

function getRewardedAdUnitId(): string {
  const mod = getAdModule();
  if (!mod) return "";

  if (__DEV__) {
    return mod.TestIds.REWARDED;
  }

  // TODO: Replace with actual ad unit IDs from AdMob console
  return Platform.select({
    ios: "ca-app-pub-4640414097368188/7995042374",
    android: "ca-app-pub-4640414097368188/9802123652",
    default: "",
  }) as string;
}

export type AdState =
  | "idle"
  | "loading"
  | "loaded"
  | "showing"
  | "rewarded"
  // User closed the ad before earning the reward (distinct from a load/show
  // failure). Must NOT grant free access — the caller re-presents the ad.
  | "dismissed"
  | "error";

export interface RewardedAdController {
  load: () => void;
  show: () => Promise<void>;
  getState: () => AdState;
  onStateChange: (callback: (state: AdState) => void) => () => void;
  dispose: () => void;
}

export function createRewardedAdController(): RewardedAdController | null {
  const mod = getAdModule();
  if (!mod) return null;

  const { RewardedAd, RewardedAdEventType, AdEventType } = mod;
  const adUnitId = getRewardedAdUnitId();

  let state: AdState = "idle";
  let listeners: ((state: AdState) => void)[] = [];
  let unsubscribers: (() => void)[] = [];
  type RewardedAdInstance = {
    load: () => void;
    show: () => Promise<void>;
    addAdEventListener: (event: string, callback: () => void) => () => void;
  };
  let rewardedAd: RewardedAdInstance | null = null;
  let adRewardEarned = false;

  function setState(newState: AdState) {
    state = newState;
    listeners.forEach((cb) => cb(newState));
  }

  function setupAd() {
    unsubscribers.forEach((unsub) => unsub());
    unsubscribers = [];
    adRewardEarned = false;

    rewardedAd = RewardedAd.createForAdRequest(adUnitId) as RewardedAdInstance;
    const ad = rewardedAd;

    unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        setState("loaded");
      }),
    );

    unsubscribers.push(
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        adRewardEarned = true;
        setState("rewarded");
      }),
    );

    unsubscribers.push(
      ad.addAdEventListener(AdEventType.CLOSED, () => {
        if (!adRewardEarned) {
          // Closed without earning the reward — the user dismissed it. Report
          // "dismissed" (not "error") so the export gate stays closed and the
          // caller can re-present the ad instead of granting free access.
          setState("dismissed");
        }
      }),
    );

    unsubscribers.push(
      ad.addAdEventListener(AdEventType.ERROR, () => {
        setState("error");
      }),
    );
  }

  return {
    load() {
      setupAd();
      setState("loading");
      rewardedAd!.load();
    },

    async show() {
      if (state !== "loaded" || !rewardedAd) {
        throw new Error("Ad is not loaded yet");
      }
      setState("showing");
      await rewardedAd.show();
    },

    getState() {
      return state;
    },

    onStateChange(callback) {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((cb) => cb !== callback);
      };
    },

    dispose() {
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers = [];
      listeners = [];
      rewardedAd = null;
      state = "idle";
    },
  };
}
