import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getBlockedPushFrame, acquireBuyLightningLock, releaseBuyLightningLock, resetAnimationLocksForTests } from '../features/air-scanner-lab/utils/animationTimelines';
import { MAX_RENDERED_COINS } from '../features/air-scanner-lab/state/airScannerVisualState';
import { mockScannerCoins } from '../features/air-scanner-lab/state/mockScannerFeed';
import { auditOrbLabelOrientation, badgeLabelIsMirrored, calculateFrontFacingLabelOffset } from '../features/air-scanner-lab/utils/orbLabelOrientation';
import { createOpenPositionTransferAudit, createTransferBeamPath, getOpenPositionRowAnchor, shouldStartOpenPositionTransfer } from '../features/air-scanner-lab/utils/openPositionTransfer';
import { mapMockCoinToVisualState } from '../features/air-scanner-lab/utils/visualStateMapper';

assert.equal(mapMockCoinToVisualState({ rawState: 'scanning' }), 'scanning');
assert.equal(mapMockCoinToVisualState({ rawState: 'wait_candidate' }), 'wait');
assert.equal(mapMockCoinToVisualState({ rawState: 'buy_candidate', isSelectedBuy: true }), 'buy_pull_to_core');
assert.equal(mapMockCoinToVisualState({ rawState: 'blocked_candidate' }), 'blocked_push_out');
assert.equal(MAX_RENDERED_COINS, 40);
assert.equal(mockScannerCoins.length, 40);

resetAnimationLocksForTests();
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), false);
releaseBuyLightningLock('UNIUSDT', 'cycle-1');
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);

const blockedStart: [number, number, number] = [3.45, 1.9, 0.25];
const blockedFrame = getBlockedPushFrame(blockedStart, 9_000);
assert.ok(Math.hypot(blockedFrame.position[0], blockedFrame.position[2]) > Math.hypot(blockedStart[0], blockedStart[2]));
assert.ok(blockedFrame.opacity < 1);

const labelAudit = auditOrbLabelOrientation({
  symbol: 'UNIUSDT',
  usesCameraBillboard: true,
  labelRotatesWithOrb: false,
  positiveScale: true,
});
assert.equal(labelAudit.facingCamera, true);
assert.equal(labelAudit.mirroredDetected, false);
for (const badge of ['BUY', 'WAIT', 'BLOCKED']) {
  assert.equal(badgeLabelIsMirrored({ usesCameraBillboard: true, labelRotatesWithOrb: false, positiveScale: true }), false, `${badge} badge should not mirror`);
}
const frontOffset = calculateFrontFacingLabelOffset({
  cameraPosition: [0, 4.15, 7.6],
  orbPosition: [-3.05, 1.75, 0.7],
  radius: 0.62,
});
assert.ok(frontOffset[2] > 0, 'label offset should move toward the camera-facing hemisphere');
assert.ok(Math.abs(Math.hypot(...frontOffset) - 0.62) < 0.0001, 'label offset should stay mounted at the requested radius');

const completedLifecycles = new Set<number>();
const transferDecision = shouldStartOpenPositionTransfer({
  symbol: 'UNIUSDT',
  expectedSymbol: 'UNIUSDT',
  openPositionConfirmed: true,
  rowFound: true,
  targetPanelMounted: true,
  lifecycleId: 42,
  completedLifecycles,
});
assert.equal(transferDecision.start, true);
const rowAnchor = getOpenPositionRowAnchor(
  { left: 100, top: 50, width: 900, height: 600 },
  { left: 700, top: 120, width: 440, height: 40 },
);
assert.deepEqual(rowAnchor, { x: 624, y: 90 });
assert.ok(createTransferBeamPath({ x: 320, y: 380 }, rowAnchor).startsWith('M 320.0 380.0 C'));
const transferAudit = createOpenPositionTransferAudit({
  symbol: 'UNIUSDT',
  rowFound: true,
  rowHighlighted: true,
  beamStartedAt: '2026-06-16T00:00:00.000Z',
});
assert.equal(transferAudit.targetPanel, 'open_positions');
assert.equal(transferAudit.rowHighlighted, true);

assert.equal(shouldStartOpenPositionTransfer({
  symbol: 'UNIUSDT',
  expectedSymbol: 'UNIUSDT',
  openPositionConfirmed: false,
  rowFound: true,
  targetPanelMounted: true,
  lifecycleId: 43,
  completedLifecycles,
}).start, false);
completedLifecycles.add(42);
assert.equal(shouldStartOpenPositionTransfer({
  symbol: 'UNIUSDT',
  expectedSymbol: 'UNIUSDT',
  openPositionConfirmed: true,
  rowFound: true,
  targetPanelMounted: true,
  lifecycleId: 42,
  completedLifecycles,
}).reason, 'duplicate lifecycle event');

const featureRoot = join(process.cwd(), 'src', 'features', 'air-scanner-lab');
const forbiddenImports = [
  'core/trading',
  'TradingEngine',
  'LiveBinanceAdapter',
  'PaperExchangeAdapter',
  'MarketScanner',
  'AutoRuntime',
  'ExecutionPlanner',
  'RiskEngine',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

for (const file of walk(featureRoot)) {
  const contents = readFileSync(file, 'utf8');
  for (const forbidden of forbiddenImports) {
    assert.equal(contents.includes(forbidden), false, `${file} imports or references ${forbidden}`);
  }
}

console.log('air-scanner-lab tests passed');
