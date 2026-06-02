import type { AirCoin } from "../../types/trade-v4";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function updateAirCoinMotion(coin: AirCoin, nowMs: number): AirCoin {
  const t = nowMs;

  if (coin.visualState === "approved" || coin.visualState === "capturing") {
    const nextProgress = Math.min(1, coin.captureProgress + 0.008);

    return {
      ...coin,
      captureProgress: nextProgress,
      x: lerp(coin.x, 0, 0.045),
      y: lerp(coin.y, 0, 0.045),
      z: lerp(coin.z, 180, 0.045),
    };
  }

  if (coin.visualState === "open" || coin.visualState === "closed") {
    return coin;
  }

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

export function depthToVisuals(z: number) {
  const normalized = Math.max(0, Math.min(1, (z + 320) / 620));
  return {
    scale: 0.72 + normalized * 0.58,
    opacity: 0.42 + normalized * 0.58,
    blurPx: Math.max(0, 1.8 - normalized * 1.8),
  };
}
