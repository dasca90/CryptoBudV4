import { readFileSync } from 'node:fs';
import { buildTradeV4PageModel } from '../lib/air-scanner/tradeV4DataAdapter';
import type { ScannerCandidate, ScannerSnapshot } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function candidate(symbol: string): ScannerCandidate {
  return {
    candidateId: `cand_${symbol}`,
    symbol,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: 'AUTO',
    riskGroup: 'mid_caps',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.8,
    status: 'BUY',
    traderBrainDecision: {} as any,
    entryGateDecision: { decision: 'ALLOW' } as any,
    mainReason: 'BUY_READY',
    requiredNextActions: [],
    blockReasons: [],
    warnings: [],
    price: 10,
    priceAgeMs: 100,
    spreadPct: 0.05,
    volumeRel: 1.5,
    tpRoomOk: true,
    reboundConfirmed: true,
    momentumConfirmed: true,
    dipPercent: 0,
    reboundPercent: 0.5,
    m5Change: 0.4,
    m15Change: 0.5,
    h1Change: 0.6,
    change24h: 2,
    mlBadEntryRisk: false,
    mlWinProbability: 0.8,
    rank: 1,
    dataQuality: 'GOOD' as any,
    priceFresh: true,
    bookFresh: true,
    filtersOk: true,
    isTradable: true,
  } as ScannerCandidate;
}

const candidates = [candidate('BTCUSDT'), candidate('ETHUSDT')];
const snapshot: ScannerSnapshot = {
  scanId: 'dipper_card_canonical_scan',
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  status: 'COOLDOWN',
  universeMode: 'BINANCE_TOP_250',
  universeSize: 250,
  scannedCount: 250,
  candidateCount: 250,
  buyCount: 184,
  waitCount: 66,
  blockCount: 0,
  avoidCount: 0,
  candidates,
  summary: 'canonical count test',
  diagnostics: {} as any,
  executionPoolSize: 184,
  watchPoolSize: 66,
  nearMissPoolSize: 0,
} as ScannerSnapshot;

const model = buildTradeV4PageModel({
  scannerSnapshot: snapshot,
  positions: [],
  closedTrades: [],
  selectedSymbol: null,
  scannerRunning: true,
  engineOnline: true,
  mode: 'PAPER',
  capital: 1000,
  usedCapital: 0,
  pnlToday: 0,
  dataQuality: 'GOOD',
  isOrderLocked: () => false,
  paperAutoEnabled: true,
  storeOpenPositionsCount: 0,
  positionManagerOpenCount: 0,
  headerPositionsCount: 0,
  openPanelRowsCount: 0,
  activeMode: 'AUTO',
});

ok(model.dipperCardState?.engineReviewCount === 184, 'Dipper canonical ready count equals post-router executionPoolSize');
ok(model.executionPoolSize === 184, 'TradeV4 model exposes canonical executionPoolSize');

const tradePageSrc = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const controlTowerSrc = readFileSync('src/components/trade-v4/ControlTowerPanel.tsx', 'utf8');

ok(tradePageSrc.includes('props.model.executionPoolSize ??'), 'TradeV4Page passes canonical executionPoolSize into Dipper card');
ok(controlTowerSrc.includes('const uiValue = [canonical.scannerStatus'), 'Dipper card render audit uses canonical rendered value for uiValue');
ok(!controlTowerSrc.includes('props.candidateCount, props.engineReviewCount, props.openCount'), 'Dipper card no longer audits stale prop count as UI value');

if (failed > 0) {
  console.error(`dipper-card-canonical-count: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`dipper-card-canonical-count: ${passed} passed, ${failed} failed`);
