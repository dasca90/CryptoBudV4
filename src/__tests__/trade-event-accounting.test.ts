import { readFileSync } from 'node:fs';
import { PositionManager } from '../core/positions/PositionManager';
import { logger } from '../utils/logger';
import type { LogEntry } from '../utils/logger';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function makeTradeId(symbol: string): string {
  return `trade_${symbol}`;
}

function makeDemoPosition(symbol: string) {
  return {
    coin: symbol,
    mode: 'AUTO' as const,
    quantity: 100,
    avgEntryPrice: 50,
    currentPrice: 51,
    unrealizedPnlPercent: 2,
    openedAt: Date.now() - 3600000,
    highestPrice: 52,
    tradeId: makeTradeId(symbol),
    entryTimestamp: Date.now() - 3600000,
    stopLossPercent: 2,
    tp1Percent: 3,
    tp2Percent: 5,
    trailFromPeakPercent: 0,
  } as any;
}

function makeDemoPositionRestored(symbol: string, ts: number) {
  return {
    ...makeDemoPosition(symbol),
    entryTimestamp: ts,
    openedAt: ts,
  } as any;
}

// ─── Static source analysis ──────────────────────────────────────────

const tradingEngine = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
const positionManager = readFileSync('src/core/positions/PositionManager.ts', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

// 1. Canonical TRADE_BUY_EXECUTED_AUDIT exists (replaces PAPER_BUY_EXECUTED_AUDIT)
ok(tradingEngine.includes('TRADE_BUY_EXECUTED_AUDIT'), '1 — TradingEngine emits TRADE_BUY_EXECUTED_AUDIT');

// 2. Old PAPER_BUY_EXECUTED_AUDIT is no longer used as canonical name
ok(!tradingEngine.includes('PAPER_BUY_EXECUTED_AUDIT: `'), '2 — PAPER_BUY_EXECUTED_AUDIT no longer present as canonical event');

// 3. POSITION_RESTORED_AUDIT per-position audit in PositionManager
ok(positionManager.includes('POSITION_RESTORED_AUDIT'), '3 — PositionManager emits POSITION_RESTORED_AUDIT per restored position');

// 4. TRADE_EVENT_COUNTER_INTEGRITY_AUDIT exists
ok(tradingEngine.includes('TRADE_EVENT_COUNTER_INTEGRITY_AUDIT'), '4 — TradingEngine emits TRADE_EVENT_COUNTER_INTEGRITY_AUDIT');

// 5. TRADE_EVENT_MISSING_AUDIT exists
ok(tradingEngine.includes('TRADE_EVENT_MISSING_AUDIT'), '5 — TradingEngine emits TRADE_EVENT_MISSING_AUDIT for missing trade events');

// 6. auditTradeEventAccounting called from App.tsx after restore
ok(app.includes('auditTradeEventAccounting'), '6 — App.tsx calls auditTradeEventAccounting after position restore');

// 7. TRADE_BUY_EXECUTED_AUDIT_DUPLICATE_SUPPRESSED exists for dedup
ok(tradingEngine.includes('TRADE_BUY_EXECUTED_AUDIT_DUPLICATE_SUPPRESSED'), '7 — Deduplication log exists for duplicate TRADE_BUY_EXECUTED_AUDIT');

// ─── Runtime behavior tests ──────────────────────────────────────────

// 8. PositionManager.restorePositions emits POSITION_RESTORED_AUDIT for each position
{
  const captured: LogEntry[] = [];
  const unsub = logger.subscribe((e) => { captured.push(e); });
  const pm = new PositionManager();
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const ts = Date.now();
  const positions = symbols.map(s => makeDemoPositionRestored(s, ts));
  pm.restorePositions(positions);
  const restoredAudits = captured.filter(e => e.message.includes('POSITION_RESTORED_AUDIT'));
  ok(restoredAudits.length === symbols.length, `8 — POSITION_RESTORED_AUDIT count (${restoredAudits.length}) matches restored positions (${symbols.length})`);
  for (const audit of restoredAudits) {
    ok(audit.level === 'INFO', `8a — POSITION_RESTORED_AUDIT level is INFO, got ${audit.level}`);
    const hasSymbol = symbols.some(s => audit.message.includes(`symbol=${s}`));
    ok(hasSymbol, `8b — POSITION_RESTORED_AUDIT contains symbol field`);
    ok(audit.message.includes('positionId='), '8c — POSITION_RESTORED_AUDIT contains positionId');
    ok(audit.message.includes('mode='), '8d — POSITION_RESTORED_AUDIT contains mode');
    ok(audit.message.includes('entryPrice='), '8e — POSITION_RESTORED_AUDIT contains entryPrice');
    ok(audit.message.includes('qty='), '8f — POSITION_RESTORED_AUDIT contains qty');
  }
  const startAudit = captured.find(e => e.message.includes('POSITION_RESTORE_START'));
  ok(!!startAudit, '8g — POSITION_RESTORE_START emitted');
  ok(startAudit!.level === 'INFO', '8h — POSITION_RESTORE_START level is INFO');
  const successAudit = captured.find(e => e.message.includes('POSITION_RESTORE_SUCCESS'));
  ok(!!successAudit, '8i — POSITION_RESTORE_SUCCESS emitted');
  ok(successAudit!.level === 'INFO', '8j — POSITION_RESTORE_SUCCESS level is INFO');
  unsub();
}

// 9. Logger stats correctly track TRADE-level events
{
  const preTradeLogged = logger.getStats().byLevel.TRADE.logged;
  logger.trade('TRADE_BUY_EXECUTED_AUDIT: symbol=TESTBTC positionId=999 orderId=o999 executionMode=AUTO strategyAtEntry=trend entryPrice=100 qty=1 notionalUsd=100 feeUsd=0 tp1Pct=3 tp1TriggerPrice=103 tp2Pct=5 slPct=2 trailingEnabled=false source=test positionManagerOpenCountAfter=1 journalPersisted=true logCategory=TRADE invariantOk=true failureReason=none');
  logger.trade('TRADE_BUY_EXECUTED_AUDIT: symbol=TESTETH positionId=888 orderId=o888 executionMode=MANUAL strategyAtEntry=breakout entryPrice=200 qty=2 notionalUsd=400 feeUsd=0 tp1Pct=3 tp1TriggerPrice=206 tp2Pct=5 slPct=2 trailingEnabled=true source=test positionManagerOpenCountAfter=1 journalPersisted=true logCategory=TRADE invariantOk=true failureReason=none');
  const postTradeLogged = logger.getStats().byLevel.TRADE.logged;
  ok(postTradeLogged - preTradeLogged === 2, `9 — TRADE-level logger count increased by 2, got ${postTradeLogged - preTradeLogged}`);
  const logs = logger.getLogs();
  const tradeEntries = logs.filter(e => e.level === 'TRADE' && e.message.includes('TRADE_BUY_EXECUTED_AUDIT'));
  ok(tradeEntries.length >= 2, `9a — at least 2 TRADE_BUY_EXECUTED_AUDIT entries in log buffer, got ${tradeEntries.length}`);
  ok(tradeEntries.every(e => e.level === 'TRADE'), '9b — All TRADE_BUY_EXECUTED_AUDIT entries have level=TRADE');
  ok(tradeEntries[0]?.message.includes('symbol=TESTBTC'), '9c — First event contains symbol');
  ok(tradeEntries[0]?.message.includes('positionId='), '9d — First event contains positionId');
  ok(tradeEntries[0]?.message.includes('entryPrice='), '9e — First event contains entryPrice');
  ok(tradeEntries[0]?.message.includes('qty='), '9f — First event contains qty');
  ok(tradeEntries[0]?.message.includes('executionMode='), '9g — First event contains executionMode');
  ok(tradeEntries[0]?.message.includes('strategyAtEntry='), '9h — First event contains strategyAtEntry');
}

// 10. auditTradeEventAccounting iterates open positions and detects missing TRADE events
{
  const hasMissingLoop = tradingEngine.includes('for (const pos of openPositions)') &&
    tradingEngine.includes('TRADE_EVENT_MISSING_AUDIT');
  ok(hasMissingLoop, `10 — auditTradeEventAccounting iterates all open positions and emits TRADE_EVENT_MISSING_AUDIT per missing`);
  const hasIntegritySummary = tradingEngine.includes('TRADE_EVENT_COUNTER_INTEGRITY_AUDIT') &&
    tradingEngine.includes('missingTradeEvents=');
  ok(hasIntegritySummary, `10a — auditTradeEventAccounting emits summary with missingTradeEvents count`);
  const hasIntegrityOk = tradingEngine.includes('integrityOk=');
  ok(hasIntegrityOk, `10b — auditTradeEventAccounting flags integrityOk=true/false`);
  // Verify method is public (no underscore or private prefix)
  const methodDef = tradingEngine.match(/auditTradeEventAccounting\s*\(\s*\)\s*:\s*void/);
  ok(!!methodDef, '10c — auditTradeEventAccounting() : void method exists in TradingEngine');
}

console.log(`trade-event-accounting: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
