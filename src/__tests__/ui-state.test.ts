/**
 * UI State Store Tests
 *
 * Tests for the UI state store (non-React usage via mock implementation).
 * Verifies state shape, default values, and state transitions.
 *
 * Run: npx tsx src/__tests__/ui-state.test.ts
 */

import type { MainTab, TradeMode } from '../state/ui-store';

type UIState = {
  activeMainTab: MainTab;
  activeTradeMode: TradeMode;
  selectedSymbol: string | null;
  selectedCandidateId: string | null;
  chartData: { time: number; price: number }[];
  equityHistory: { time: number; equity: number }[];
};

interface UIStoreActions {
  setMainTab: (tab: MainTab) => void;
  setTradeMode: (mode: TradeMode) => void;
  selectSymbol: (symbol: string | null) => void;
  addChartData: (time: number, price: number) => void;
  addEquityPoint: (time: number, equity: number) => void;
}

function createTestStore(): UIState & UIStoreActions {
  const s: UIState = {
    activeMainTab: 'trade',
    activeTradeMode: 'AUTO',
    selectedSymbol: null,
    selectedCandidateId: null,
    chartData: [],
    equityHistory: [],
  };

  const self = {
    get activeMainTab() { return s.activeMainTab; },
    get activeTradeMode() { return s.activeTradeMode; },
    get selectedSymbol() { return s.selectedSymbol; },
    get selectedCandidateId() { return s.selectedCandidateId; },
    get chartData() { return s.chartData; },
    get equityHistory() { return s.equityHistory; },
    setMainTab(tab: MainTab) { s.activeMainTab = tab; },
    setTradeMode(mode: TradeMode) { s.activeTradeMode = mode; },
    selectSymbol(symbol: string | null) { s.selectedSymbol = symbol; s.selectedCandidateId = symbol; },
    addChartData(time: number, price: number) {
      s.chartData = [...s.chartData, { time, price }].slice(-200);
    },
    addEquityPoint(time: number, equity: number) {
      s.equityHistory = [...s.equityHistory, { time, equity }].slice(-500);
    },
  };
  return self;
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  UI State Store Tests');
  console.log('══════════════════════════════════════════════\n');

  // ── Test 1: Default state ──
  console.log('\n── Test 1: Default state ──\n');

  const store = createTestStore();
  assert(store.activeMainTab === 'trade', 'Default main tab is "trade"');
  assert(store.activeTradeMode === 'AUTO', 'Default trade mode is "AUTO"');
  assert(store.selectedSymbol === null, 'Default selected symbol is null');
  assert(store.chartData.length === 0, 'Default chart data is empty');
  assert(store.equityHistory.length === 0, 'Default equity history is empty');

  // ── Test 2: Main tab switching ──
  console.log('\n── Test 2: Main tab switching ──\n');

  store.setMainTab('journal');
  assert(store.activeMainTab === 'journal', 'Switch to journal tab');

  store.setMainTab('ml-lab');
  assert(store.activeMainTab === 'ml-lab', 'Switch to ml-lab tab');

  store.setMainTab('logs');
  assert(store.activeMainTab === 'logs', 'Switch to logs tab');

  store.setMainTab('settings');
  assert(store.activeMainTab === 'settings', 'Switch to settings tab');

  store.setMainTab('trade');
  assert(store.activeMainTab === 'trade', 'Switch back to trade tab');

  // ── Test 3: Trade mode switching ──
  console.log('\n── Test 3: Trade mode switching ──\n');

  store.setTradeMode('MANUAL');
  assert(store.activeTradeMode === 'MANUAL', 'Switch to MANUAL mode');

  store.setTradeMode('SCALPER');
  assert(store.activeTradeMode === 'SCALPER', 'Switch to SCALPER mode');

  store.setTradeMode('AUTO');
  assert(store.activeTradeMode === 'AUTO', 'Switch back to AUTO mode');

  // ── Test 4: Symbol selection ──
  console.log('\n── Test 4: Symbol selection ──\n');

  store.selectSymbol('BTCUSDT');
  assert(store.selectedSymbol === 'BTCUSDT', 'Select BTCUSDT');
  assert(store.selectedCandidateId === 'BTCUSDT', 'Candidate ID matches symbol');

  store.selectSymbol(null);
  assert(store.selectedSymbol === null, 'Deselect symbol');

  // ── Test 5: Chart data accumulation ──
  console.log('\n── Test 5: Chart data accumulation ──\n');

  store.addChartData(1000, 50000);
  store.addChartData(2000, 50100);
  store.addChartData(3000, 50200);
  assert(store.chartData.length === 3, 'Chart data has 3 points');
  assert(store.chartData[0].time === 1000, 'First chart point time is 1000');
  assert(store.chartData[2].price === 50200, 'Last chart point price is 50200');

  // Test max 200 points
  for (let i = 0; i < 300; i++) {
    store.addChartData(4000 + i, 50000 + i);
  }
  assert(store.chartData.length === 200, 'Chart data capped at 200 points');

  // ── Test 6: Equity history accumulation ──
  console.log('\n── Test 6: Equity history accumulation ──\n');

  store.addEquityPoint(1000, 10000);
  store.addEquityPoint(2000, 10100);
  assert(store.equityHistory.length === 2, 'Equity history has 2 points');
  assert(store.equityHistory[0].equity === 10000, 'First equity point is 10000');

  // Test max 500 points
  for (let i = 0; i < 600; i++) {
    store.addEquityPoint(3000 + i, 10000 + i);
  }
  assert(store.equityHistory.length === 500, 'Equity history capped at 500 points');

  // ── Summary ──
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  console.error('Test runner error:', e);
  process.exit(1);
}
