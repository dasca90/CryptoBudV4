import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getVisibleTopCandidates } from '../components/trade-v4/topCandidatesPanelModel';
import { getVisibleOpenPositions } from '../components/trade-v4/openPositionsPanelModel';
import type { TradeV4CandidateView, TradeV4OpenPositionView } from '../components/trade-v4/types';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const candidates = [
  { candidateId: '1', symbol: 'AAAUSDT', source: 'dipper', status: 'WAIT', confidence: 60 },
  { candidateId: '2', symbol: 'BBBUSDT', source: 'scalper', status: 'BUY', confidence: 80, professionalScore: 92 },
  { candidateId: '3', symbol: 'CCCUSDT', source: 'dipper', status: 'BLOCK', confidence: 30 },
] as TradeV4CandidateView[];

assert.deepEqual(
  getVisibleTopCandidates(candidates, 'All').map((c) => c.symbol),
  ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'],
  'TopCandidatesPanel memo selector preserves incoming candidate order for All',
);
assert.deepEqual(
  getVisibleTopCandidates(candidates, 'Dipper').map((c) => c.symbol),
  ['AAAUSDT', 'CCCUSDT'],
  'TopCandidatesPanel memo selector preserves source-filtered candidate order',
);

const positions = [
  { id: '1', symbol: 'CCCUSDT', ownerType: 'AutoBots', pnlUsd: 1.1, pnlPct: 0.5, ageLabel: '3m', priceQuality: 'fresh' },
  { id: '2', symbol: 'AAAUSDT', ownerType: 'Manual', pnlUsd: -0.4, pnlPct: -0.2, ageLabel: '1m', priceQuality: 'stale' },
  { id: '3', symbol: 'BBBUSDT', ownerType: 'AutoBots', pnlUsd: 0, pnlPct: 0, ageLabel: '2m', priceQuality: 'fresh' },
] as TradeV4OpenPositionView[];

assert.deepEqual(
  getVisibleOpenPositions({
    positions,
    ownerFilter: 'all',
    resultFilter: 'all',
    priceFilter: 'all',
    sortBy: 'age',
    sortDir: 'desc',
  }).map((p) => p.symbol),
  ['CCCUSDT', 'BBBUSDT', 'AAAUSDT'],
  'OpenPositionsPanel memo selector preserves default age desc row order',
);
assert.deepEqual(
  getVisibleOpenPositions({
    positions,
    ownerFilter: 'auto',
    resultFilter: 'all',
    priceFilter: 'fresh',
    sortBy: 'symbol',
    sortDir: 'asc',
  }).map((p) => p.symbol),
  ['BBBUSDT', 'CCCUSDT'],
  'OpenPositionsPanel memo selector preserves filtered symbol order',
);

const logsPage = read('src/ui/pages/LogsPage.tsx');
assert.ok(logsPage.includes('LOGS_PAGE_UPDATE_THROTTLE_MS = 100'), 'LogsPage keeps the required 100ms throttle');
assert.ok(logsPage.includes('if (throttleTimerRef.current) return;'), 'LogsPage uses throttle batching rather than endlessly resetting debounce');
assert.ok(logsPage.includes('logger.getRecentLogs(500)'), 'LogsPage flush reads from logger storage, so queued logs are not dropped or reordered');
assert.ok(logsPage.includes('LOGS_PAGE_THROTTLE_AUDIT') && logsPage.includes('IS_DEV'), 'LogsPage throttle audit is dev-only');

const canvas = read('src/features/air-scanner-lab/AirScannerCanvas.tsx');
assert.ok(canvas.includes("frameloop={visible ? 'always' : 'never'}"), 'AirScannerCanvas pauses R3F frameloop while document is hidden');
assert.ok(canvas.includes("removeEventListener('visibilitychange'"), 'AirScannerCanvas cleans up visibility listener on unmount');

const tradePage = read('src/components/trade-v4/TradeV4Page.tsx');
assert.ok(tradePage.includes('UI_RENDER_FREQUENCY_AUDIT') && tradePage.includes('if (!IS_DEV) return;'), 'TradeV4Page render audit is dev-only');
assert.ok(!tradePage.includes('setInterval') || !tradePage.includes('TRADE_V4_LAYOUT_REBALANCE_AUDIT'), 'TradeV4Page has no production layout audit interval');

const scannerCoreFiles = [
  'src/core/scanner/MarketScanner.ts',
  'src/core/scanner/ScannerBrainService.ts',
  'src/core/trading/TradingEngine.ts',
];
for (const file of scannerCoreFiles) {
  assert.ok(!read(file).includes('UI_RENDER_FREQUENCY_AUDIT'), `${file} has no UI performance audit leakage into trading/scanner logic`);
}

console.log('phase1-performance-optimizations.test.ts passed');
