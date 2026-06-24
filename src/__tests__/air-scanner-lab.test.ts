import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PerspectiveCamera, Vector3 } from 'three';
import { getBlockedPushFrame, getOpenPositionTransferPosition, acquireBuyLightningLock, releaseBuyLightningLock, resetAnimationLocksForTests } from '../features/air-scanner-lab/utils/animationTimelines';
import { BUY_TRANSFER_HERO_POSITION, MAX_RENDERED_COINS } from '../features/air-scanner-lab/state/airScannerVisualState';
import { FOCUSED_COIN_FRONT_POSITION } from '../features/air-scanner-lab/components/ScannerScene';
import { mockScannerCoins } from '../features/air-scanner-lab/state/mockScannerFeed';
import { auditOrbLabelOrientation, badgeLabelIsMirrored, calculateFrontFacingLabelOffset } from '../features/air-scanner-lab/utils/orbLabelOrientation';
import { createOpenPositionTransferAudit, createTransferBeamPath, getOpenPositionRowAnchor, shouldStartOpenPositionTransfer } from '../features/air-scanner-lab/utils/openPositionTransfer';
import { mapMockCoinToVisualState } from '../features/air-scanner-lab/utils/visualStateMapper';
import { mapProductionModelToAirScannerLab } from '../features/air-scanner-lab/airScannerAdapter';
import { is3DScannerLabPreviewEnabled } from '../features/air-scanner-lab/featureFlag';
import type { TradeV4CandidateView, TradeV4OpenPositionView, TradeV4PageModel } from '../components/trade-v4/types';

interface TestWindow {
  location: { search: string };
  localStorage: { getItem: (key: string) => string | null };
}

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function withTestWindow(testWindow: TestWindow, run: () => void): void {
  Object.defineProperty(globalThis, 'window', {
    value: testWindow,
    configurable: true,
  });

  try {
    run();
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

assert.equal(mapMockCoinToVisualState({ rawState: 'scanning' }), 'scanning');
assert.equal(mapMockCoinToVisualState({ rawState: 'wait_candidate' }), 'wait');
assert.equal(mapMockCoinToVisualState({ rawState: 'buy_candidate', isSelectedBuy: true }), 'buy_pull_to_core');
assert.equal(mapMockCoinToVisualState({ rawState: 'blocked_candidate' }), 'blocked_push_out');
assert.equal(MAX_RENDERED_COINS, 40);
assert.equal(mockScannerCoins.length, 40);

assert.equal(is3DScannerLabPreviewEnabled(), false, 'feature flag defaults off outside browser context');
withTestWindow({
  location: { search: '' },
  localStorage: { getItem: () => null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), true, '3D scanner preview is enabled by default in browser/app context');
});
withTestWindow({
  location: { search: '?enable3DScannerLabPreview=true' },
  localStorage: { getItem: () => null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), true, 'feature flag can be enabled with query param');
});
withTestWindow({
  location: { search: '?enable3DScannerLabPreview=false' },
  localStorage: { getItem: () => 'true' },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), false, 'query param false overrides localStorage opt-in');
});
withTestWindow({
  location: { search: '' },
  localStorage: { getItem: (key) => key === 'enable3DScannerLabPreview' ? 'false' : null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), true, 'stale old feature flag false value does not keep the app on the legacy scanner');
});
withTestWindow({
  location: { search: '?useLegacyAirScanner3D=true' },
  localStorage: { getItem: () => null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), false, 'legacy scanner fallback can be forced with query param');
});
withTestWindow({
  location: { search: '' },
  localStorage: { getItem: (key) => key === 'useLegacyAirScanner3D' ? 'true' : null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), false, 'legacy scanner fallback can be forced with dedicated localStorage rollback key');
});
withTestWindow({
  location: { search: '' },
  localStorage: { getItem: (key) => key === 'enable3DScannerLabPreview' ? 'true' : null },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), true, 'feature flag can be enabled with localStorage');
});
withTestWindow({
  location: { search: '' },
  localStorage: {
    getItem: () => {
      throw new Error('storage blocked');
    },
  },
}, () => {
  assert.equal(is3DScannerLabPreviewEnabled(), false, 'feature flag fails closed if browser storage access throws');
});

resetAnimationLocksForTests();
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), false);
releaseBuyLightningLock('UNIUSDT', 'cycle-1');
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);

const blockedStart: [number, number, number] = [3.45, 1.9, 0.25];
const blockedFrame = getBlockedPushFrame(blockedStart, 9_000);
assert.ok(Math.hypot(blockedFrame.position[0], blockedFrame.position[2]) > Math.hypot(blockedStart[0], blockedStart[2]));
assert.ok(blockedFrame.opacity < 1);
const openTransferEnd = getOpenPositionTransferPosition([0.25, 2.35, 0], 1);
assert.ok(openTransferEnd[0] > 4, 'buy transfer should move toward open positions panel side');
assert.ok(openTransferEnd[1] > 3, 'buy transfer should lift toward the open positions panel');

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
assert.deepEqual(rowAnchor, { x: 600, y: 90 });
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

function createCandidate(symbol: string, index: number, status: TradeV4CandidateView['status'] = 'WAIT'): TradeV4CandidateView {
  return {
    candidateId: `candidate-${symbol}`,
    symbol,
    price: 1 + index,
    rank: index + 1,
    score: 80 - index,
    confidenceSource: 'test',
    source: 'test',
    riskGroup: index % 3 === 0 ? 'Top Caps' : index % 3 === 1 ? 'Mid Caps' : 'High Risk',
    strategy: 'balanced',
    status,
    engineState: status === 'BUY' ? 'approved' : status === 'BLOCK' ? 'rejected' : 'detected',
    confidence: 70,
    spreadPct: 0.12,
    volumeRel: 1.2,
    dipPct: null,
    reboundPct: null,
    tpRoomPct: null,
    momentum: null,
    mainReason: status === 'BLOCK' ? 'Spread too high' : 'test candidate',
    requiredNextAction: null,
    blockReasons: status === 'BLOCK' ? ['Spread too high'] : [],
    mlBadEntryRisk: null,
    dataQuality: 'GOOD',
    isOrderLocked: false,
    finalExecutable: status === 'BUY',
    buyAllowed: status === 'BUY',
  };
}

const openUniPosition: TradeV4OpenPositionView = {
  id: 'position-uni',
  symbol: 'UNIUSDT',
  entryPrice: 13.74,
  livePrice: 13.94,
  pnlPct: 1.48,
  pnlUsd: 4.07,
  tp1Pct: 2,
  tp2Pct: 4,
  slPct: 1.5,
  trailState: 'off',
  ageLabel: '12s',
  status: 'open',
  strategy: 'balanced',
  riskGroup: 'Mid',
  groupTrend: 'Bullish',
  exitStatus: 'monitoring',
  priceQuality: 'fresh',
  usedCapitalUsd: 274.8,
};

const productionModel = {
  candidates: Array.from({ length: 45 }, (_, index) => createCandidate(index === 0 ? 'UNIUSDT' : `COIN${index}USDT`, index, index === 0 ? 'BUY' : index === 2 ? 'BLOCK' : 'WAIT')),
  openPositions: [openUniPosition],
  closedPositions: [],
  selectedSymbol: 'UNIUSDT',
  scannerRunning: true,
  engineOnline: true,
  mode: 'PAPER',
  capital: 1000,
  usedCapital: 274.8,
  pnlToday: 4.07,
  dataQuality: 'GOOD',
  publicDataReady: true,
  publicDataRefreshing: false,
  paperAutoResult: {
    attempted: true,
    executed: true,
    blocked: false,
    symbol: 'UNIUSDT',
    reason: 'test open',
    gateResults: [],
    stage: 'PositionOpened',
    positionCreated: true,
  },
  executionPlan: {
    canExecute: true,
    selectedCandidates: [{
      symbol: 'UNIUSDT',
      rank: 1,
      status: 'BUY',
      effectiveStrategy: 'balanced',
      groupTrend: 'Bullish',
      groupRecommendedStrategy: 'balanced',
      confidence: 70,
      score: 80,
      plannedAction: 'BUY',
      reason: 'test',
      requiredChecks: [],
    }],
    skippedCandidates: [],
    noBuyReasons: [],
    executionPoolSize: 1,
    watchPoolSize: 0,
    nearMissPoolSize: 0,
    maxEntriesPerCycle: 1,
    availableSlots: 9,
    capitalAvailable: 725.2,
    decisionMode: 'test',
    executionAdapter: 'paper',
  },
} satisfies TradeV4PageModel;

const labView = mapProductionModelToAirScannerLab(productionModel);
assert.equal(labView.coins.length, MAX_RENDERED_COINS, 'production adapter caps visual coins at lab max');
assert.equal(labView.visualState, 'buy_pull_to_core', 'selected BUY candidate drives transfer visual state');
assert.equal(labView.selectedCoin?.symbol, 'UNIUSDT', 'selected symbol maps to selected lab coin');
assert.equal(labView.selectedCoin?.isSelectedBuy, true, 'selected execution candidate is visually emphasized');
assert.equal(labView.openPositions.length, 1, 'open positions remain separate visual rows');
assert.equal(labView.openPositions[0].symbol, 'UNIUSDT');
assert.equal(labView.openPositions[0].highlighted, true, 'confirmed/opened symbol highlights Open Positions row');
assert.equal(labView.coins.find((coin) => coin.symbol === 'COIN2USDT')?.rawState, 'blocked_candidate', 'blocked production candidates map to blocked lab visuals');
const waitWithBuyAllowed = mapProductionModelToAirScannerLab({
  ...productionModel,
  candidates: [{ ...createCandidate('WAITUSDT', 0, 'WAIT'), buyAllowed: true, finalExecutable: true }],
  openPositions: [],
  selectedSymbol: null,
  paperAutoResult: undefined,
  executionPlan: { ...productionModel.executionPlan, selectedCandidates: [] },
});
assert.equal(waitWithBuyAllowed.coins[0].rawState, 'wait_candidate', 'explicit WAIT status keeps amber WAIT color even when permissive flags are present');
const floatingWithPermissiveFlags = mapProductionModelToAirScannerLab({
  ...productionModel,
  candidates: [{ ...createCandidate('FLOATUSDT', 0, 'AVOID'), buyAllowed: true, finalExecutable: true }],
  openPositions: [],
  selectedSymbol: null,
  paperAutoResult: undefined,
  executionPlan: { ...productionModel.executionPlan, selectedCandidates: [] },
});
assert.equal(floatingWithPermissiveFlags.coins[0].rawState, 'blocked_candidate', 'AVOID/BLOCK-style candidates stay non-buy even if permissive flags are present');
assert.deepEqual(labView.coins.find((coin) => coin.symbol === 'UNIUSDT')?.position, BUY_TRANSFER_HERO_POSITION, 'selected BUY coin gets a lower front-facing hero position instead of drifting into the packed rings');
const selectedWaitView = mapProductionModelToAirScannerLab({
  ...productionModel,
  candidates: [
    { ...createCandidate('WAITSELUSDT', 0, 'WAIT') },
  ],
  selectedSymbol: 'WAITSELUSDT',
  openPositions: [],
  paperAutoResult: undefined,
  executionPlan: {
    ...productionModel.executionPlan,
    selectedCandidates: [],
  },
});
const selectedWaitCoin = selectedWaitView.coins.find((coin) => coin.symbol === 'WAITSELUSDT');
assert.equal(selectedWaitCoin?.isSelectedBuy, false, 'focused coin does not hijack BUY-transfer state unless it is actually selected for execution');
assert.notDeepEqual(selectedWaitCoin?.position, [0, 0.78, 5.2], 'focused non-BUY selection stays in the scanner field instead of being pinned to the front-center slot');
assert.notDeepEqual(selectedWaitCoin?.position, BUY_TRANSFER_HERO_POSITION, 'focused non-BUY selection does not occupy the BUY center slot');
assert.ok(Math.hypot(selectedWaitCoin?.position[0] ?? 0, selectedWaitCoin?.position[2] ?? 0) >= 3.5, 'focused non-BUY selection still floats outside the reserved scanner center');
assert.deepEqual(FOCUSED_COIN_FRONT_POSITION, [0, 1.18, 5.2], 'clicked/focused sphere has a centered front-of-camera visual anchor');
assert.notDeepEqual(FOCUSED_COIN_FRONT_POSITION, BUY_TRANSFER_HERO_POSITION, 'clicked/focused sphere does not reuse the active BUY transfer core slot');
assert.ok(Math.hypot(FOCUSED_COIN_FRONT_POSITION[0], FOCUSED_COIN_FRONT_POSITION[2]) >= 3.5, 'clicked/focused sphere remains outside the reserved scanner core');
const productionCamera = new PerspectiveCamera(54, 16 / 9, 0.1, 100);
productionCamera.position.set(0, 5.35, 10.7);
productionCamera.updateMatrixWorld();
productionCamera.updateProjectionMatrix();
const projectedFocus = new Vector3(...FOCUSED_COIN_FRONT_POSITION).project(productionCamera);
assert.ok(Math.abs(projectedFocus.x) < 0.0001, `clicked/focused sphere projects to screen center instead of left; projectedX=${projectedFocus.x}`);
const queuedBuyView = mapProductionModelToAirScannerLab({
  ...productionModel,
  candidates: [
    { ...createCandidate('BUYNOWUSDT', 0, 'BUY') },
    { ...createCandidate('BUYNEXTUSDT', 1, 'BUY') },
    { ...createCandidate('BUYTHIRDUSDT', 2, 'BUY') },
  ],
  selectedSymbol: 'BUYNEXTUSDT',
  openPositions: [],
  paperAutoResult: undefined,
  executionPlan: {
    ...productionModel.executionPlan,
    selectedCandidates: [
      { symbol: 'BUYNOWUSDT', rank: 1, status: 'BUY', effectiveStrategy: 'balanced', groupTrend: 'Bullish', groupRecommendedStrategy: 'balanced', confidence: 70, score: 80, plannedAction: 'BUY', reason: 'test', requiredChecks: [] },
      { symbol: 'BUYNEXTUSDT', rank: 2, status: 'BUY', effectiveStrategy: 'balanced', groupTrend: 'Bullish', groupRecommendedStrategy: 'balanced', confidence: 69, score: 79, plannedAction: 'BUY', reason: 'queued', requiredChecks: [] },
      { symbol: 'BUYTHIRDUSDT', rank: 3, status: 'BUY', effectiveStrategy: 'balanced', groupTrend: 'Bullish', groupRecommendedStrategy: 'balanced', confidence: 68, score: 78, plannedAction: 'BUY', reason: 'queued', requiredChecks: [] },
    ],
  },
});
assert.deepEqual(queuedBuyView.coins.find((coin) => coin.symbol === 'BUYNOWUSDT')?.position, BUY_TRANSFER_HERO_POSITION, 'first BUY queue candidate owns the center transfer slot');
assert.equal(queuedBuyView.coins.find((coin) => coin.symbol === 'BUYNOWUSDT')?.isSelectedBuy, true, 'only active BUY transfer candidate is marked selected buy');
for (const queuedSymbol of ['BUYNEXTUSDT', 'BUYTHIRDUSDT']) {
  const queuedCoin = queuedBuyView.coins.find((coin) => coin.symbol === queuedSymbol);
  assert.equal(queuedCoin?.rawState, 'buy_candidate', `${queuedSymbol} remains visibly BUY-ready in queue`);
  assert.equal(queuedCoin?.isSelectedBuy, false, `${queuedSymbol} waits in queue instead of becoming magenta transfer coin`);
  assert.ok(Math.hypot(queuedCoin?.position[0] ?? 0, queuedCoin?.position[2] ?? 0) >= 3.5, `${queuedSymbol} stays outside scanner center while waiting`);
}
assert.equal(queuedBuyView.coins.filter((coin) => coin.isSelectedBuy).length, 1, 'scanner has exactly one selected BUY transfer coin at a time');
let minimumPackedDistance = Number.POSITIVE_INFINITY;
let minimumCenterDistance = Number.POSITIVE_INFINITY;
for (let i = 0; i < labView.coins.length; i += 1) {
  for (let j = i + 1; j < labView.coins.length; j += 1) {
    const first = labView.coins[i];
    const second = labView.coins[j];
    if (first.isSelectedBuy || second.isSelectedBuy) continue;
    minimumPackedDistance = Math.min(
      minimumPackedDistance,
      Math.hypot(first.position[0] - second.position[0], first.position[2] - second.position[2]),
    );
  }
  const coin = labView.coins[i];
  if (!coin.isSelectedBuy) {
    minimumCenterDistance = Math.min(minimumCenterDistance, Math.hypot(coin.position[0], coin.position[2]));
  }
}
assert.ok(minimumPackedDistance >= 0.95, `40-coin production layout keeps readable spacing between non-selected orbs; min=${minimumPackedDistance.toFixed(3)}`);
assert.ok(minimumCenterDistance >= 3.5, `scanner center stays reserved only for active BUY coins; min center distance=${minimumCenterDistance.toFixed(3)}`);

const flagSource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'featureFlag.ts'), 'utf8');
assert.ok(flagSource.includes("return false"), 'production lab preview feature flag defaults off without browser state');
assert.ok(flagSource.includes('enable3DScannerLabPreview'), 'feature flag has explicit opt-in key');
assert.ok(flagSource.includes('return true'), 'production lab preview defaults on in browser/app context');
assert.ok(flagSource.includes('try {'), 'feature flag access is guarded so blocked localStorage/query access cannot crash Trade V4');
assert.ok(flagSource.includes('catch'), 'feature flag fails closed when browser storage access throws');

const productionPreviewSource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'AirScannerProductionPreview.tsx'), 'utf8');
assert.ok(productionPreviewSource.includes('mapProductionModelToAirScannerLab'), 'production preview uses the pure adapter');
assert.equal(productionPreviewSource.includes('view.selectedCoin?.symbol ?? view.coins.find((coin) => coin.isSelectedBuy)?.symbol'), false, 'mere selection no longer hijacks transfer symbol');
assert.ok(productionPreviewSource.includes('getBoundingClientRect') && productionPreviewSource.includes('rect.left + point.x'), 'production preview converts scanner-local transfer source into viewport coordinates for the fixed transfer overlay');
assert.ok(productionPreviewSource.includes('showScanCard={false}'), 'production preview does not render the scanning checklist over the 3D scanner');
assert.equal(productionPreviewSource.includes('onManualBuy'), false, 'production preview does not receive manual buy callbacks');
assert.equal(productionPreviewSource.includes('TradingEngine'), false, 'production preview does not import trading engine');

const productionOverlaySource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'ProductionOpenPositionTransferOverlay.tsx'), 'utf8');
const airScannerLabCssSource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'air-scanner-lab.css'), 'utf8');
assert.ok(productionOverlaySource.includes('[data-testid="open-positions-panel"]'), 'production transfer overlay anchors to the real Open Positions panel');
assert.ok(productionOverlaySource.includes('data-open-position-symbol') && productionOverlaySource.includes('rowRect.top + rowRect.height / 2'), 'production transfer beam targets the exact Open Positions row for the bought symbol');
assert.ok(productionOverlaySource.includes('requestAnimationFrame(updateLiveTarget)') && productionOverlaySource.includes('setBeam((current) =>'), 'production transfer beam continuously retargets the live Open Positions row while the list moves');
assert.ok(productionOverlaySource.includes('rowFound') && productionOverlaySource.includes('air-lab-production-transfer-target-lock'), 'production transfer overlay marks exact row locks separately from fallback panel anchors');
assert.equal(productionOverlaySource.includes('air-lab-production-transfer-source-flare'), false, 'production transfer overlay does not render a magenta source flare circle');
assert.equal(airScannerLabCssSource.includes('air-lab-production-transfer-source-flare'), false, 'production transfer styles do not keep the magenta source flare class');
assert.ok(productionOverlaySource.includes('TRANSFER_DURATION_MS = 30_000'), 'production transfer beam disappears after 30 seconds');
assert.ok(productionOverlaySource.includes('cycleKeyRef'), 'production transfer lifecycle uses a ref so React state updates do not cancel the 30-second timer');
assert.equal(productionOverlaySource.includes('setCycleKey'), false, 'production transfer overlay does not use cycle key state that can retrigger and clear the fade timer');
assert.equal(productionOverlaySource.includes('onManualBuy'), false, 'production transfer overlay has no trade callbacks');

const scannerSceneSource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'components', 'ScannerScene.tsx'), 'utf8');
assert.ok(scannerSceneSource.includes('BUY_TRANSFER_HERO_POSITION'), 'scanner scene uses the shared lower/front BUY hero position');
assert.ok(scannerSceneSource.includes('FOCUSED_COIN_FRONT_POSITION') && scannerSceneSource.includes('position = FOCUSED_COIN_FRONT_POSITION'), 'scanner scene pins clicked non-transfer coins to the centered front-of-camera slot');
assert.ok(scannerSceneSource.includes('getRoamingCoinPosition') && scannerSceneSource.includes('coin.isFocused !== true'), 'scanner scene keeps roaming disabled for the user-selected focused coin');
assert.ok(scannerSceneSource.includes('LightningArc') && scannerSceneSource.includes('buyPullSource'), 'scanner scene draws a magenta pull lightning only during the active BUY transfer');
assert.ok(scannerSceneSource.includes('BUY_TRANSFER_VISIBLE_OPACITY_MIN = 0.9'), 'scanner scene keeps the center transfer sphere visible while the transfer beam remains active');
assert.equal(scannerSceneSource.includes('progress >= 0.995 ? 0.02'), false, 'scanner scene does not fade the teleported center sphere out before the transfer beam disappears');
assert.ok(scannerSceneSource.includes('enforceCenterKeepOut') && scannerSceneSource.includes('CENTER_KEEP_OUT_RADIUS = 4.55'), 'scanner scene reserves a wider center zone so only active BUY coins can occupy it');
assert.ok(scannerSceneSource.includes('heroDistance >= 2.65'), 'scanner scene clears nearby packed orbs away from the selected BUY hero position');
assert.ok(scannerSceneSource.includes('resolveOrbCollisions') && scannerSceneSource.includes('getCollisionRadius'), 'scanner scene runs a collision/repel pass so visible orbs do not sit on top of each other');
assert.ok(scannerSceneSource.includes('resolveProjectedOverlaps') && scannerSceneSource.includes('SCREEN_SPACE_PERSONAL_SPACE'), 'scanner scene also resolves camera-projected overlap so spheres do not still stack visually after 3D separation');
assert.ok(scannerSceneSource.includes("if (selectedState === 'scanning') return mapMockCoinToVisualState(coin);"), 'scanning mode preserves color-coded coin states instead of flattening WAIT/BLOCK colors');
assert.ok(scannerSceneSource.includes('COLLISION_MAX_SPEED = 0.035') && scannerSceneSource.includes('COLLISION_RESPONSE = 0.055'), 'collision solver keeps slow, soft sphere drift instead of violent direction changes');
assert.ok(scannerSceneSource.includes('velocityRef') && scannerSceneSource.includes('COLLISION_DAMPING') && scannerSceneSource.includes('COLLISION_RESPONSE') && scannerSceneSource.includes('COLLISION_VERTICAL_WEIGHT'), 'collision solver keeps per-orb velocity and 3D weighting so spheres nudge and bounce like soft balls instead of sliding through each other');

const adapterSource = readFileSync(join(process.cwd(), 'src', 'features', 'air-scanner-lab', 'airScannerAdapter.ts'), 'utf8');
assert.ok(adapterSource.includes('orderCandidatesForScene'), 'production adapter reorders scene candidates for a more even spread before positioning');
assert.ok(adapterSource.includes("if (candidate.status === 'BUY') return 'buy_candidate';"), 'adapter only paints BUY-ready coins green from canonical BUY status, not from permissive flags alone');
assert.equal(adapterSource.includes('FOCUSED_COIN_FRONT_POSITION'), false, 'production adapter does not own the local visual focus slot');

const tradeV4PageSource = readFileSync(join(process.cwd(), 'src', 'components', 'trade-v4', 'TradeV4Page.tsx'), 'utf8');
const airScannerPageSource = readFileSync(join(process.cwd(), 'src', 'ui', 'pages', 'AirScannerPage.tsx'), 'utf8');
const openPositionsPanelSource = readFileSync(join(process.cwd(), 'src', 'components', 'trade-v4', 'OpenPositionsPanel.tsx'), 'utf8');
assert.ok(openPositionsPanelSource.includes('data-open-position-symbol={p.symbol}') && openPositionsPanelSource.includes('data-testid={`open-position-row-${p.symbol}`}'), 'Open Positions rows expose symbol anchors for buy transfer beams');
assert.equal(tradeV4PageSource.includes('<AirScanner3D'), false, 'TradeV4Page no longer mounts legacy 3D scanner');
assert.equal(tradeV4PageSource.includes('<AirScannerProductionPreview'), false, 'TradeV4Page no longer mounts lab 3D scanner');
assert.ok(tradeV4PageSource.includes('data-air-scanner-renderer="not-mounted-trade-tab"'), 'TradeV4Page exposes a non-visual scanner renderer marker for QA');
assert.ok(tradeV4PageSource.includes('scannerTelemetry={{'), 'TradeV4Page keeps scanner telemetry lightweight in Candidate Pool');
assert.ok(airScannerPageSource.includes('is3DScannerLabPreviewEnabled'), 'AirScannerPage gates lab scanner behind feature flag');
assert.ok(airScannerPageSource.includes('<AirScanner3DView'), 'existing production scanner remains as isolated fallback');
assert.ok(airScannerPageSource.includes('<AirScannerProductionPreview'), 'lab-derived scanner can mount only inside isolated tab');
assert.equal(airScannerPageSource.includes('<ProductionOpenPositionTransferOverlay'), false, 'isolated 3D tab does not mount trade-transfer overlay on Trade tab');
assert.match(
  airScannerPageSource,
  /<AirScannerProductionPreview[\s\S]*model=\{model\}[\s\S]*quality=\{graphicsQuality\}[\s\S]*onSelectSymbol=\{selectSymbol\}[\s\S]*onTransferSourceUpdate=\{\(\) => \{\}\}/,
  'AirScannerPage passes only read-only model/visual/select/telemetry props into lab-derived scanner',
);
assert.match(
  tradeV4PageSource,
  /<SelectedCoinInspector[\s\S]*onManualBuy=\{props\.onManualBuy\}/,
  'manual buy remains scoped to SelectedCoinInspector, not the scanner preview',
);

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
