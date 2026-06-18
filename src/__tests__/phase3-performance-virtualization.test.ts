import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { getVirtualRange } from '../lib/ui/virtualization';
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  getDowngradedGraphicsQuality,
  loadPerformanceSettings,
  PERFORMANCE_SETTINGS_STORAGE_KEY,
  savePerformanceSettings,
  shouldAutoDowngrade,
} from '../lib/performance/performanceSettings';

const journalSource = readFileSync('src/ui/pages/JournalPage.tsx', 'utf8');
const logsSource = readFileSync('src/ui/pages/LogsPage.tsx', 'utf8');
const closedSource = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
const openSource = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
const tradePageSource = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const settingsSource = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
const settingsPersistenceSource = readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8');
const appTypesSource = readFileSync('src/core/types/index.ts', 'utf8');
const tradeCss = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');

const journalRange = getVirtualRange({
  total: 1000,
  scrollTop: 250,
  viewportHeight: 250,
  rowHeight: 25,
  threshold: 40,
  overscan: 4,
});
assert.equal(journalRange.isVirtualized, true, 'A Journal virtualization renders a window for large datasets');
assert.ok(journalRange.visibleCount < 1000, 'A Journal virtual window renders visible rows only');
assert.equal(journalRange.totalHeightPx, 25_000, 'A Journal virtualization preserves full dataset height');

const smallRange = getVirtualRange({
  total: 12,
  scrollTop: 0,
  viewportHeight: 250,
  rowHeight: 25,
  threshold: 25,
});
assert.equal(smallRange.isVirtualized, false, 'Open Positions virtualization stays off below threshold');
assert.equal(smallRange.visibleCount, 12, 'Small tables keep normal visible behavior');

assert.ok(journalSource.includes('orderedTrades') && journalSource.includes('filtered.slice().reverse()'), 'B Journal filters/sorting still apply before virtualization');
assert.ok(journalSource.includes('generateBotReport') && journalSource.includes('trades: journal.getTrades()'), 'C Journal report/export uses full journal data, not virtual rows');
assert.ok(journalSource.includes('VIRTUALIZED_TABLE_RENDER_AUDIT') && journalSource.includes('fullDatasetPreserved=true'), 'Journal emits virtualization audit');

assert.ok(closedSource.includes('POSITION_VIRTUALIZATION_THRESHOLD = 25'), 'D Closed Positions virtualization threshold is 25 rows');
assert.ok(closedSource.includes('filteredPositions.slice(virtualWindow.startIndex, virtualWindow.endIndex)'), 'D Closed Positions virtualizes after sorting/filtering so row order is preserved');
assert.ok(closedSource.includes('orderPreserved=true'), 'D Closed Positions audit documents preserved order');

assert.ok(logsSource.includes('logger.getLogs()') && !logsSource.includes('logger.getRecentLogs(500)'), 'E Logs page does not drop logs by capping render source to 500');
assert.ok(logsSource.includes('visibleLogs') && logsSource.includes('LOGS_VIRTUALIZATION_AUDIT'), 'E Logs page renders a virtual log window');
assert.ok(logsSource.includes('JSON.stringify(displayLogs.map') && logsSource.includes('copyExportUsesFullFilteredLogs=true'), 'F Logs export/copy uses full filtered logs, not virtual rows');

assert.ok(openSource.includes('POSITION_VIRTUALIZATION_THRESHOLD = 25'), 'G Open Positions virtualization threshold is 25 rows');
assert.ok(openSource.includes('pnlDisplayPreserved=true') && openSource.includes('freshnessBadgePreserved=true'), 'G Open Positions audit protects PnL and freshness display');
assert.ok(openSource.includes('compactFreshnessLabel') && openSource.includes('pnlBreakdown?.priceFreshness'), 'G Open Positions stale/fallback PnL labels remain visible');

assert.equal(DEFAULT_PERFORMANCE_SETTINGS.graphicsQuality, 'balanced', 'H Graphics Quality default is Balanced');
assert.equal(DEFAULT_PERFORMANCE_SETTINGS.autoPerformanceMode, 'off', 'H Auto Performance Mode default is OFF');
assert.ok(appTypesSource.includes("graphicsQuality: 'balanced'") && appTypesSource.includes('autoPerformanceMode: false'), 'H AppSettings defaults persist Balanced/OFF');

const localStore = new Map<string, string>();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => localStore.get(key) ?? null,
      setItem: (key: string, value: string) => { localStore.set(key, value); },
      removeItem: (key: string) => { localStore.delete(key); },
    },
    dispatchEvent: () => true,
  },
});
savePerformanceSettings({ graphicsQuality: 'high', autoPerformanceMode: 'on' });
assert.equal(localStore.has(PERFORMANCE_SETTINGS_STORAGE_KEY), true, 'I Performance settings are persisted to localStorage');
assert.deepEqual(loadPerformanceSettings(), { graphicsQuality: 'high', autoPerformanceMode: 'on' }, 'I Performance settings load after save');

assert.equal(getDowngradedGraphicsQuality('high'), 'balanced', 'J Auto Performance downgrades High to Balanced');
assert.equal(shouldAutoDowngrade({ autoPerformanceMode: 'on', averageFps: 24, secondsBelowThreshold: 10, graphicsQuality: 'high', activeBuyTransfer: false }), true, 'J Sustained low FPS triggers High downgrade');
assert.equal(getDowngradedGraphicsQuality('balanced'), 'low', 'K Auto Performance downgrades Balanced to Low');
assert.equal(shouldAutoDowngrade({ autoPerformanceMode: 'on', averageFps: 22, secondsBelowThreshold: 10, graphicsQuality: 'balanced', activeBuyTransfer: false }), true, 'K Sustained low FPS triggers Balanced downgrade');
assert.equal(shouldAutoDowngrade({ autoPerformanceMode: 'on', averageFps: 20, secondsBelowThreshold: 10, graphicsQuality: 'balanced', activeBuyTransfer: true }), false, 'K Auto Performance does not downgrade during active BUY transfer');
assert.equal(shouldAutoDowngrade({ autoPerformanceMode: 'off', averageFps: 12, secondsBelowThreshold: 30, graphicsQuality: 'high', activeBuyTransfer: false }), false, 'K Auto Performance is user-controlled and OFF by default');

assert.equal(tradePageSource.includes('core/trading'), false, 'L Trade V4 performance wiring does not import trading logic');
assert.equal(readFileSync('src/lib/performance/useAdaptivePerformanceController.ts', 'utf8').includes('core/trading'), false, 'L Adaptive controller does not import trading logic');
assert.equal(readFileSync('src/lib/performance/performanceSettings.ts', 'utf8').includes('core/trading'), false, 'L Performance settings do not import trading logic');

assert.ok(tradeCss.includes('.graphics-quality-low') && tradeCss.includes('backdrop-filter: none') && tradeCss.includes('.status-good'), 'M Low graphics mode reduces visual effects without hiding state colors');
assert.ok(settingsSource.includes('Graphics Quality') && settingsSource.includes('Auto Performance Mode'), 'Settings UI exposes performance controls');
assert.ok(settingsPersistenceSource.includes('savePerformanceSettings') && settingsPersistenceSource.includes('normalizePerformanceSettings'), 'Performance settings are persisted with app settings');
assert.ok(tradePageSource.includes('UI_PERFORMANCE_HEALTH_AUDIT') && tradePageSource.includes('PERFORMANCE_MODE_STATE_AUDIT'), 'Performance telemetry audits are emitted');

Reflect.deleteProperty(globalThis, 'window');

console.log('phase3-performance-virtualization tests passed');

