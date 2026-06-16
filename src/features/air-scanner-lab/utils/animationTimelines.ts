import type { Vector3Tuple } from 'three';
import type { AirScannerQuality } from '../state/airScannerVisualState';

export const BUY_PULL_DURATION_MS = 20_000;
export const BLOCKED_PUSH_DURATION_MS = 9_000;
export const OPEN_POSITION_PULSE_MS = 2_000;

const activeLightningLocks = new Set<string>();

export function createAnimationId(symbol: string, state: string): string {
  return `${symbol}:${state}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function acquireBuyLightningLock(symbol: string, lifecycleId: string): boolean {
  const lockId = `${symbol}:${lifecycleId}`;
  if (activeLightningLocks.has(lockId)) return false;
  activeLightningLocks.add(lockId);
  return true;
}

export function releaseBuyLightningLock(symbol: string, lifecycleId: string): void {
  activeLightningLocks.delete(`${symbol}:${lifecycleId}`);
}

export function getActiveLightningLockCount(): number {
  return activeLightningLocks.size;
}

export function resetAnimationLocksForTests(): void {
  activeLightningLocks.clear();
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function getBuyPullProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / BUY_PULL_DURATION_MS));
}

export function getBlockedPushProgress(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / BLOCKED_PUSH_DURATION_MS));
}

export function getCurvedBuyPullPosition(start: Vector3Tuple, target: Vector3Tuple, progress: number): Vector3Tuple {
  const eased = easeInOutCubic(progress);
  const arc = Math.sin(progress * Math.PI) * 0.78;
  return [
    start[0] + (target[0] - start[0]) * eased,
    start[1] + (target[1] - start[1]) * eased + arc,
    start[2] + (target[2] - start[2]) * eased - Math.sin(progress * Math.PI) * 0.22,
  ];
}

export function getBlockedPushFrame(start: Vector3Tuple, elapsedMs: number): { position: Vector3Tuple; opacity: number } {
  const progress = getBlockedPushProgress(elapsedMs);
  const outwardLength = 2.6 * easeInOutCubic(progress);
  const horizontalLength = Math.hypot(start[0], start[2]) || 1;
  const direction: Vector3Tuple = [start[0] / horizontalLength, 0.14, start[2] / horizontalLength];
  return {
    position: [
      start[0] + direction[0] * outwardLength,
      start[1] + direction[1] * outwardLength,
      start[2] + direction[2] * outwardLength,
    ],
    opacity: Math.max(0.18, 1 - progress * 0.72),
  };
}

export function getQualityParticleMultiplier(quality: AirScannerQuality): number {
  return quality === 'ultra' ? 1.35 : quality === 'high' ? 1 : quality === 'medium' ? 0.62 : 0.34;
}
