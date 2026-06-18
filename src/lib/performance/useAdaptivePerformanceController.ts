import { useEffect, useRef } from 'react';
import { logger } from '../../utils/logger';
import { getGraphicsQualityConfig, type AirScannerQuality } from '../../features/air-scanner-lab/state/airScannerVisualState';
import { getDowngradedGraphicsQuality, shouldAutoDowngrade, type AutoPerformanceMode } from './performanceSettings';

export function useAdaptivePerformanceController(params: {
  graphicsQuality: AirScannerQuality;
  autoPerformanceMode: AutoPerformanceMode;
  activeBuyTransfer?: boolean;
  onDowngrade: (quality: AirScannerQuality) => void;
}) {
  const stateRef = useRef({
    frameCount: 0,
    windowStartedAt: 0,
    lastFrameAt: 0,
    belowSince: 0,
    lastAuditAt: 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    stateRef.current = {
      frameCount: 0,
      windowStartedAt: performance.now(),
      lastFrameAt: performance.now(),
      belowSince: 0,
      lastAuditAt: 0,
    };

    const tick = (now: number) => {
      const state = stateRef.current;
      const frameTimeMs = Math.max(0, now - state.lastFrameAt);
      state.lastFrameAt = now;
      state.frameCount += 1;
      const elapsedMs = now - state.windowStartedAt;

      if (elapsedMs >= 10_000) {
        const averageFps = (state.frameCount / elapsedMs) * 1000;
        const secondsBelowThreshold = averageFps < 25
          ? (state.belowSince > 0 ? (now - state.belowSince) / 1000 : 10)
          : 0;
        if (averageFps < 25 && state.belowSince === 0) state.belowSince = now - 10_000;
        if (averageFps >= 25) state.belowSince = 0;

        const qualityConfig = getGraphicsQualityConfig(params.graphicsQuality);
        logger.info(`PERFORMANCE_MODE_STATE_AUDIT: fps=${averageFps.toFixed(1)} frameTimeMs=${frameTimeMs.toFixed(1)} graphicsQuality=${params.graphicsQuality} autoPerformanceMode=${params.autoPerformanceMode} particleCount=${qualityConfig.ambientParticleCount} bloomStatus=${qualityConfig.bloom ? 'on' : 'off'} activeBuyTransfer=${String(params.activeBuyTransfer === true)}`);

        if (shouldAutoDowngrade({
          autoPerformanceMode: params.autoPerformanceMode,
          averageFps,
          secondsBelowThreshold,
          graphicsQuality: params.graphicsQuality,
          activeBuyTransfer: params.activeBuyTransfer === true,
        })) {
          const nextQuality = getDowngradedGraphicsQuality(params.graphicsQuality);
          logger.warn(`PERFORMANCE_AUTO_DOWNGRADE_AUDIT: from=${params.graphicsQuality} to=${nextQuality} averageFps=${averageFps.toFixed(1)} windowSeconds=10 activeBuyTransfer=false`);
          params.onDowngrade(nextQuality);
          state.belowSince = 0;
        }

        state.frameCount = 0;
        state.windowStartedAt = now;
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [params.graphicsQuality, params.autoPerformanceMode, params.activeBuyTransfer, params.onDowngrade]);
}
