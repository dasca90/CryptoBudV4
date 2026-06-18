import type { AirCoinView } from "../../components/trade-v4/types";

const SELECTED_FOCUS_TARGET = {
  x: -185,
  y: -64,
  z: 265,
};

export function updateAirCoinMotion(coin: AirCoinView, nowMs: number): AirCoinView {
  const t = nowMs;

  if (coin.engineState === "locked") {
    return {
      ...coin,
      captureProgress: 0,
      x: coin.x + (SELECTED_FOCUS_TARGET.x - coin.x) * 0.18,
      y: coin.y + (SELECTED_FOCUS_TARGET.y - coin.y) * 0.18,
      z: coin.z + (SELECTED_FOCUS_TARGET.z - coin.z) * 0.18,
    };
  }

  if (coin.engineState === "pull_to_center") {
    const progress = Math.max(0, Math.min(1, coin.pullProgress ?? 0));
    const ease = 1 - Math.pow(1 - progress, 3);
    return {
      ...coin,
      captureProgress: ease,
      x: coin.x + (0 - coin.x) * 0.08,
      y: coin.y + (0 - coin.y) * 0.08,
      z: coin.z + (220 - coin.z) * 0.08,
    };
  }

  if (coin.engineState === "locked_for_buy" || coin.engineState === "execution_submitted") {
    const pullSpeed = coin.engineState === "execution_submitted" ? 0.18 : 0.12;
    const nextProgress = Math.min(1, coin.captureProgress + (coin.engineState === "execution_submitted" ? 0.035 : 0.022));
    return {
      ...coin,
      captureProgress: nextProgress,
      x: coin.x + (0 - coin.x) * pullSpeed,
      y: coin.y + (0 - coin.y) * pullSpeed,
      z: coin.z + (210 - coin.z) * pullSpeed,
    };
  }

  if (coin.engineState === "position_opened_hold") {
    return {
      ...coin,
      captureProgress: 1,
      x: coin.x + (0 - coin.x) * 0.16,
      y: coin.y + (0 - coin.y) * 0.16,
      z: coin.z + (215 - coin.z) * 0.16,
    };
  }

  if (coin.engineState === "approved" || coin.engineState === "capturing") {
    const nextProgress = Math.min(1, coin.captureProgress + 0.008);
    return {
      ...coin,
      captureProgress: nextProgress,
      x: coin.x + (0 - coin.x) * 0.045,
      y: coin.y + (0 - coin.y) * 0.045,
      z: coin.z + (180 - coin.z) * 0.045,
    };
  }

  if (
    coin.engineState === "open" ||
    coin.engineState === "closed"
  ) return coin;

  const confidenceCenterPull = Math.min(70, Math.max(0, coin.confidence - 65));
  const targetBaseX = coin.baseX * (1 - confidenceCenterPull / 220);
  const targetBaseY = coin.baseY * (1 - confidenceCenterPull / 260);

  return {
    ...coin,
    captureProgress: 0,
    x: targetBaseX + Math.sin(t * coin.speed + coin.phase) * 18,
    y: targetBaseY + Math.cos(t * coin.speed * 0.8 + coin.phase) * 12,
    z: coin.baseZ + Math.sin(t * coin.speed * 0.5 + coin.phase) * 80,
  };
}
