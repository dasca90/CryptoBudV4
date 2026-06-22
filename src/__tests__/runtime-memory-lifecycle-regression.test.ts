/**
 * Runtime Memory/Lifecycle Regression Tests
 *
 * Focuses on long-run leak risks without changing trading rules:
 * feed subscriptions, diagnostics logger subscriptions, scanner cooldown
 * safety, bounded 48h-equivalent counters, and Air Scanner cleanup contracts.
 *
 * Run: npx tsx src/__tests__/runtime-memory-lifecycle-regression.test.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { DiagnosticsEngine } from '../core/diagnostics/DiagnosticsEngine';
import { MarketScanner } from '../core/scanner/MarketScanner';
import { ScannerBrainService } from '../core/scanner/ScannerBrainService';
import { ExitEngine } from '../core/exits/ExitEngine';
import { logger } from '../utils/logger';
import type { ExitInput, TraderBrainConfig } from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL ${msg}${detail ? ` - ${detail}` : ''}`);
  }
}

function makeConfig(coin: string): TraderBrainConfig {
  return {
    coin,
    mode: 'AUTO',
    maxPositionSize: 100,
    maxLeverage: 1,
    stopLossPercent: 2,
    takeProfitPercent: 3,
    cooldownSeconds: 0,
    minConfidence: 0,
    enabled: true,
    mlEnabled: false,
  };
}

function makeExitInput(overrides: Partial<ExitInput> = {}): ExitInput {
  return {
    coin: 'OLDUSDT',
    entryPrice: 100,
    quantity: 1,
    currentPrice: 101,
    bidPrice: 100.9,
    askPrice: 101.1,
    lastPrice: 101,
    priceTimestamp: Date.now(),
    openedAt: Date.now() - 49 * 3600 * 1000,
    highestPrice: 101,
    highestPriceSinceTp: 101,
    tpArmed: false,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 2,
    tp1Percent: 3,
    tp2Percent: 0,
    trailFromPeakPercent: 0,
    maxHoldSec: 48 * 3600,
    mode: 'AUTO',
    isLive: false,
    timeBasedExitEnabled: true,
    resumeGuardActive: true,
    exitCyclesSinceHydration: 1,
    maxTimeBasedExitsPerCycle: 2,
    priceAgeMs: 0,
    ...overrides,
  };
}

function createEngineWithFakeFeed() {
  const engine = new TradingEngine(new PaperExchangeAdapter(), new MLPredictor(), new Journal());
  const active = new Map<string, Set<number>>();
  const unsubscribeCalls: string[] = [];
  let nextId = 0;
  const fakeFeed = {
    subscribe(symbol: string, _cb: unknown) {
      const id = ++nextId;
      if (!active.has(symbol)) active.set(symbol, new Set());
      active.get(symbol)!.add(id);
      return () => {
        unsubscribeCalls.push(symbol);
        active.get(symbol)?.delete(id);
      };
    },
    getActiveSubscriptionCount() {
      let total = 0;
      for (const listeners of active.values()) total += listeners.size;
      return total;
    },
    getListenerCount(symbol: string) {
      return active.get(symbol)?.size ?? 0;
    },
    getActiveIntervalCount() {
      return active.size;
    },
  };
  (engine as any).feed = fakeFeed;
  return { engine, fakeFeed, unsubscribeCalls };
}

async function testTradingEngineSubscriptions() {
  console.log('\n-- TradingEngine feed subscription lifecycle --');
  const { engine, fakeFeed, unsubscribeCalls } = createEngineWithFakeFeed();

  engine.addBrain(makeConfig('SUBUSDT'));
  assert((engine as any).feedUnsubs.size === 1, 'addBrain stores one unsubscribe');
  assert(fakeFeed.getListenerCount('SUBUSDT') === 1, 'addBrain creates one active feed listener');

  engine.addBrain(makeConfig('SUBUSDT'));
  assert(unsubscribeCalls.length === 1, 'addBrain same symbol unsubscribes previous feed first');
  assert(fakeFeed.getListenerCount('SUBUSDT') === 1, 'addBrain same symbol leaves one active listener');

  engine.removeBrain('SUBUSDT');
  assert(unsubscribeCalls.length === 2, 'removeBrain calls unsubscribe exactly once for current listener');
  assert(fakeFeed.getListenerCount('SUBUSDT') === 0, 'removeBrain removes active listener');
  assert((engine as any).feedUnsubs.size === 0, 'removeBrain cleans feedUnsubs map');

  for (let i = 0; i < 100; i++) {
    engine.addBrain(makeConfig('CYCLEUSDT'));
    engine.removeBrain('CYCLEUSDT');
  }
  assert(fakeFeed.getActiveSubscriptionCount() === 0, 'repeated add/remove cycles leave zero active subscriptions');

  engine.addBrain(makeConfig('RESUMEUSDT'));
  for (let i = 0; i < 20; i++) {
    engine.resumeGuardReset();
    await engine.start();
    await engine.stop();
  }
  assert(fakeFeed.getListenerCount('RESUMEUSDT') === 1, 'start/stop/resume simulation does not duplicate feed listeners');
  engine.removeBrain('RESUMEUSDT');
}

function testDiagnosticsLifecycle() {
  console.log('\n-- DiagnosticsEngine logger subscription lifecycle --');
  const before = logger.getListenerCount();
  const diagnostics = new DiagnosticsEngine();
  assert(logger.getListenerCount() === before + 1, 'DiagnosticsEngine constructor subscribes once');
  diagnostics.destroy();
  assert(logger.getListenerCount() === before, 'DiagnosticsEngine.destroy removes logger subscription');

  for (let i = 0; i < 50; i++) {
    const instance = new DiagnosticsEngine();
    instance.destroy();
  }
  assert(logger.getListenerCount() === before, 'repeated DiagnosticsEngine create/destroy does not leak listeners');

  const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert(appSource.includes('diagnosticsEngine.destroy()'), 'App lifecycle calls DiagnosticsEngine.destroy on unmount');
}

async function testMarketScannerCooldownStopStart() {
  console.log('\n-- MarketScanner recentlyClosedSymbols cooldown safety --');
  const scanner = new MarketScanner();
  scanner.recordClose({
    symbol: 'COOLDOWNUSDT',
    pnlPct: 1.2,
    pnlUsd: 3,
    exitReason: 'TP1_FIXED',
    strategy: 'balanced',
  });
  assert(scanner.isRecentlyClosedSymbolInCooldown('COOLDOWNUSDT'), 'recently closed symbol starts in cooldown');
  assert(scanner.getRecentlyClosedCooldownCount() === 1, 'cooldown map has one entry after recordClose');

  await scanner.stop();
  assert(scanner.isRecentlyClosedSymbolInCooldown('COOLDOWNUSDT'), 'scanner stop does not clear anti-rebuy cooldown');

  await scanner.start();
  await scanner.stop();
  assert(scanner.isRecentlyClosedSymbolInCooldown('COOLDOWNUSDT'), 'scanner stop/start keeps cooldown until expiry');

  const cooldowns = (scanner as any).recentlyClosedSymbols as Map<string, { cooldownUntil: number }>;
  const current = cooldowns.get('COOLDOWNUSDT');
  if (current) current.cooldownUntil = Date.now() - 1;
  assert(!scanner.isRecentlyClosedSymbolInCooldown('COOLDOWNUSDT'), 'cooldown expires by time, not by scanner restart');
  scanner.destroy();
}

async function testFortyEightHourEquivalentBounds() {
  console.log('\n-- 48h-equivalent bounded runtime simulation --');
  const fakeAdapter = { isLive: false, name: 'Test' } as any;
  const fakeML = { feedPrice() {} } as any;
  const manualBrains = new Map();
  const brainService = new ScannerBrainService(manualBrains, fakeAdapter, fakeML);
  (brainService as any).maxTempBrains = 250;

  for (let tick = 0; tick < 5760; tick++) {
    brainService.getOrCreateBrainForSymbol(`SIM${String(tick % 500).padStart(4, '0')}USDT`);
  }
  assert(brainService.getTempBrainCount() <= 250, '48h simulation keeps ScannerBrainService tempBrains bounded');

  const { engine, fakeFeed } = createEngineWithFakeFeed();
  for (let tick = 0; tick < 288; tick++) {
    const symbol = `FEED${String(tick % 24).padStart(2, '0')}USDT`;
    engine.addBrain(makeConfig(symbol));
    if (tick % 2 === 0) engine.addBrain(makeConfig(symbol));
    if (tick % 3 === 0) engine.removeBrain(symbol);
  }
  assert(fakeFeed.getActiveSubscriptionCount() <= 24, '48h simulation keeps active feed subscriptions bounded');

  const listenerBaseline = logger.getListenerCount();
  for (let tick = 0; tick < 288; tick++) {
    const diagnostics = new DiagnosticsEngine();
    diagnostics.snapshot();
    diagnostics.destroy();
  }
  assert(logger.getListenerCount() === listenerBaseline, '48h simulation does not grow diagnostics subscriptions');

  const scanner = new MarketScanner();
  for (let tick = 0; tick < 40; tick++) {
    scanner.startCandidateRevalidationLoop();
    scanner.stopCandidateRevalidationLoop();
  }
  assert((scanner as any).revalidationTimerId === null, '48h simulation does not leave duplicate scanner revalidation loops');
  scanner.destroy();

  logger.setMaxLogs(2000);
  for (let tick = 0; tick < 5000; tick++) logger.info(`FORTY_EIGHT_HOUR_RUNTIME_AUDIT tick=${tick}`);
  assert(logger.getStats().currentLogCount <= logger.getStats().maxLogCount, '48h simulation keeps logs bounded');

  const exitEngine = new ExitEngine();
  exitEngine.startCycle(1);
  const hydratedOldPositions = Array.from({ length: 5 }, (_, index) => makeExitInput({ coin: `OLD${index}USDT` }));
  const closesDuringGuard = hydratedOldPositions.filter((input) => exitEngine.evaluateExit(input).shouldClosePosition).length;
  assert(closesDuringGuard === 0, 'hydration guard prevents Time-Based Exit mass close');

  const releasedExitEngine = new ExitEngine();
  releasedExitEngine.startCycle(2);
  const closesAfterGuard = hydratedOldPositions
    .map((input) => ({ ...input, resumeGuardActive: false, exitCyclesSinceHydration: 6 }))
    .filter((input) => releasedExitEngine.evaluateExit(input).shouldClosePosition).length;
  assert(closesAfterGuard === 2, 'post-guard Time-Based Exit remains batch-limited');
}

function testAirScannerCleanupContracts() {
  console.log('\n-- 3D Air Scanner cleanup contracts --');
  const root = process.cwd();
  const rafHook = readFileSync(resolve(root, 'src/hooks/useRafLoop.ts'), 'utf8');
  const overlay = readFileSync(resolve(root, 'src/features/air-scanner-lab/ProductionOpenPositionTransferOverlay.tsx'), 'utf8');
  const animationTimelines = readFileSync(resolve(root, 'src/features/air-scanner-lab/utils/animationTimelines.ts'), 'utf8');
  const scannerScene = readFileSync(resolve(root, 'src/features/air-scanner-lab/components/ScannerScene.tsx'), 'utf8');
  const pulse = readFileSync(resolve(root, 'src/features/air-scanner-lab/components/VolumetricScanPulse.tsx'), 'utf8');

  assert(rafHook.includes('cancelAnimationFrame'), 'shared RAF hook cancels animation frames');
  assert(overlay.includes('cancelAnimationFrame(rafId)'), 'open-position transfer overlay cancels RAF on cleanup');
  assert(animationTimelines.includes('activeLightningLocks.delete'), 'lightning locks have release path');
  assert(scannerScene.includes('releaseBuyLightningLock'), 'ScannerScene releases lightning locks');
  assert(pulse.includes('age > SCAN_PULSE_IMPACT_DURATION_MS') && pulse.includes('continue'), 'volumetric pulse impacts expire instead of accumulating forever');
  assert(pulse.includes('Array.from({ length: 34 }'), 'volumetric pulse particle instances are fixed-size');
}

async function main() {
  await testTradingEngineSubscriptions();
  testDiagnosticsLifecycle();
  await testMarketScannerCooldownStopStart();
  await testFortyEightHourEquivalentBounds();
  testAirScannerCleanupContracts();

  console.log(`\nruntime-memory-lifecycle-regression: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
