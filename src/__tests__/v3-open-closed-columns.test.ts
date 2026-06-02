import { readFileSync } from 'node:fs';
import { mapTradeRecordToClosedPositionView, mapPositionToOpenPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import { V3_OPEN_POSITION_COLUMNS } from '../components/trade-v4/OpenPositionsPanel';
import { V3_CLOSED_POSITION_COLUMNS } from '../components/trade-v4/ClosedPositionsPanel';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const openPanel = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
const closedPanel = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
const adapter = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');

ok(JSON.stringify(V3_OPEN_POSITION_COLUMNS) === JSON.stringify(['Symbol','State','Strategy','Qty','Entry Value','Entry','Ref','Last','Dip','Trend','PnL%','Unrealized','TP1 (%)','TP2 (%)','Stop (%)','Stop Trigger','Decision','Owner','Opened At','Hold']), '1 open panel keeps exact V3 core columns');
ok(closedPanel.includes('Realized Total:') && closedPanel.includes('Win Rate:') && closedPanel.includes('Closed:'), '2 closed panel header summary is visible');
ok(adapter.includes('OPEN_POSITIONS_V3_MAPPING_AUDIT') && adapter.includes('CLOSED_POSITIONS_V3_MAPPING_AUDIT'), '3 adapter emits V3 mapping audits');
ok(JSON.stringify(V3_CLOSED_POSITION_COLUMNS) === JSON.stringify(['Symbol','Owner','Strategy','Mode','Qty','Entry Value','Entry Price','Exit Price','Exit Value','Realized PnL %','Realized PnL $','Gross Result','Opened At','Closed At','Hold','Exit Reason','Ref@Entry','Dip@Entry','Rebound@Entry','Trend@Entry','Notes']), '3b closed panel keeps exact V3 core columns');

const open = mapPositionToOpenPositionView({
  coin: 'AAAUSDT', quantity: 1, avgEntryPrice: 10, currentPrice: 11, pnl: 1, pnlPercent: 10, unrealizedPnlPercent: 10,
  mode: 'AUTO', openedAt: Date.now() - 10000, highestPrice: 11, highestPriceSinceTp: 11, tpArmed: false, tpArmedAt: Date.now(), tp1Hit: false, tp2Hit: false,
  stopLossPercent: 1.5, tp1Percent: 2, tp2Percent: 0, tpMode: 'fixed_single', tpTriggerType: 'tp1', trailFromPeakPercent: 0.25, maxHoldSec: 3600, lastPrice: 11,
  ownerType: 'scanner', adapter: 'Demo', buySnapshot: { realMarketPriceAtBuy: 10.2, selectedStrategy: 'balanced', settingsSnapshot: {}, traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: {} } } } as any,
} as any);
ok(typeof open.refPrice === 'number', '4 open mapping exposes refPrice');

const closed = mapTradeRecordToClosedPositionView({
  tradeId: 'c1', coin: 'AAAUSDT', mode: 'AUTO', side: 'SELL', adapter: 'Demo', entryPrice: 10, exitPrice: 11, quantity: 1, pnl: 1, pnlPercent: 10,
  entryTime: '2026-06-01T10:00:00.000Z', exitTime: '2026-06-01T10:05:00.000Z', status: 'closed', strategy: 'balanced', buySnapshot: { selectedStrategy: 'balanced', traderBrainDecision: { ruleDecisionTrace: { unifiedSignal: {} } } } as any,
} as any);
ok(closed.openedAtLabel === '2026-06-01T10:00:00.000Z', '5 closed mapping keeps openedAt');

console.log(`v3-open-closed-columns: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
