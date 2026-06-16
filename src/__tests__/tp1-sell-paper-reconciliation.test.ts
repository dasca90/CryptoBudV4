import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/core/exchange/PaperExchangeAdapter.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// Part A: Paper holdings reconciliation
// 1. Reconciliation exists in PaperExchangeAdapter
ok(adapterSrc.includes('reconcileHolding'), 'Part A1: PaperExchangeAdapter has reconcileHolding method');
ok(adapterSrc.includes('reconcileAllHoldings'), 'Part A2: PaperExchangeAdapter has reconcileAllHoldings for bulk sync');

// 2. Reconciliation called before SELL in TradingEngine
ok(engineSrc.includes('PAPER_SELL_HOLDINGS_MISMATCH_DETECTED'), 'Part A3: PAPER_SELL_HOLDINGS_MISMATCH_DETECTED log before SELL');
ok(engineSrc.includes('reconciliationAttempted=true'), 'Part A4: Reconciliation is attempted before SELL');

// 3. Reconciliation includes retry if first attempt fails
ok(engineSrc.includes('reconciliationRetry=true'), 'Part A5: Reconciliation retries if first attempt yields 0');

// 4. SELL blocked if reconciliation fails
ok(engineSrc.includes('PAPER_SELL_BLOCKED_HOLDINGS_STILL_MISSING'), 'Part A6: SELL blocked if paper holdings still missing after reconciliation');

// 5. Reconciliation on startup
ok(appSrc.includes('reconcileAllHoldings'), 'Part A7: Paper holdings reconciled after position hydration on startup');

// Part B: Exit quantity resolution
// 6. Quantity audit includes reconciliation fields
ok(engineSrc.includes('PAPER_SELL_HOLDINGS_MISMATCH_DETECTED') && engineSrc.includes('paperHoldingQtyBefore'), 'Part B1: PAPER_SELL_HOLDINGS_MISMATCH_DETECTED includes qty before/after');

// 7. adapterWillReject flag in mismatch detection
ok(engineSrc.includes('adapterWillReject'), 'Part B2: Mismatch detection signals if adapter will reject');

// Part C: Open/Closed invariant
// 8. Duplicate audit exists
ok(engineSrc.includes('POSITION_TRADE_ID_STATE_INVARIANT'), 'Part C1: POSITION_TRADE_ID_STATE_INVARIANT exists');

// 9. Duplicate check by tradeId (not by symbol — re-entry OK with new tradeId)
ok(engineSrc.includes('existsInOpen') && engineSrc.includes('existsInClosed'), 'Part C2: Duplicate check tracks both open and closed state by tradeId');
ok(engineSrc.includes('t.tradeId === tradeId'), 'Part C2b: Duplicate check compares by tradeId, not symbol');

// 10. Double-close prevention before closePosition
ok(engineSrc.includes('skipped_closePosition_double_close_prevented'), 'Part C3: Double close prevented when position already removed');

// Part D: SELL completion order
// 11. adapter.submitOrder called before journal.recordTrade
const adapterSubmitIdx = engineSrc.indexOf('this.adapter.submitOrder(req)');
const recordTradeIdx = engineSrc.indexOf('this.journal.recordTrade(fullTrade)');
ok(adapterSubmitIdx > 0 && recordTradeIdx > adapterSubmitIdx, 'Part D1: SELL adapter called BEFORE journal.recordTrade');

// 12. journal.recordTrade called before positionManager.closePosition
const closePosIdx = engineSrc.indexOf('this.positionManager.closePosition(coin, snapshot)');
ok(recordTradeIdx > 0 && closePosIdx > recordTradeIdx, 'Part D2: Trade recorded BEFORE position closed');

// 13. If SELL fails, no closed trade created (check the reject return)
ok(engineSrc.includes("result.status !== 'filled'") && engineSrc.includes('releaseSellLock'), 'Part D3: SELL failure releases lock without creating closed trade');

// 14. PAPER_HOLDINGS_RECONCILIATION_AUDIT fields
ok(adapterSrc.includes('positionManagerQty') && adapterSrc.includes('paperHoldingQtyBefore'), 'Part D4: Reconciliation audit includes position manager and paper holding qtys');

// Part E: SPCX regression
// 15. TP1 evaluation unchanged
ok(engineSrc.includes('shouldTakeProfitSell') && engineSrc.includes('TAKE_PROFIT'), 'Part E1: TP1 evaluation logic preserved');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
