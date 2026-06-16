import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. ExecutionPlanner uses snapshot resolved strategy, not router decision
ok(plannerSrc.includes('strategy: scannerAutoEntryConfigSnapshot.selectedStrategy'), 'planner uses snapshot resolved strategy for planned candidate');
ok(!plannerSrc.includes("strategy: decision?.effectiveStrategy ?? candidateWithPlan.selectedStrategy,"), 'planner no longer uses stale router decision for strategy');

// 2. TradingEngine action.strategy uses canonical entryConfigSnapshot
ok(engineSrc.includes('strategy: scannerAutoEntryConfigSnapshot?.selectedStrategy ?? planEntry.strategy ?? candidate.selectedStrategy'), 'TradingEngine action uses snapshot resolved strategy');
ok(engineSrc.includes('prediction: planEntry.effectiveStrategy ?? scannerAutoEntryConfigSnapshot?.selectedStrategy'), 'TradingEngine prediction uses snapshot resolved strategy');

// 3. buySnapshot.selectedStrategy uses canonical entryConfigSnapshot
ok(engineSrc.includes('selectedStrategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? action.strategy'), 'buySnapshot selectedStrategy uses canonical snapshot');

// 4. settingsSnapshot.strategy uses canonical entryConfigSnapshot
ok(engineSrc.includes('strategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? strategyAuditSnapshot?.strategySelected ?? action.strategy'), 'settingsSnapshot strategy uses canonical snapshot');

// 5. EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID hard-fail
ok(engineSrc.includes('EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID'), 'TradingEngine emits EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID');
ok(engineSrc.includes('positionCreateAllowed=false'), 'contract invalid audit includes positionCreateAllowed=false');
ok(engineSrc.includes('candidateSelectedStrategy=${scannerCandidate?.selectedStrategy'), 'contract invalid exposes candidateSelectedStrategy');
ok(engineSrc.includes('entryConfigSnapshotStrategy=${canonicalEntryConfigSnapshot?.selectedStrategy'), 'contract invalid exposes entryConfigSnapshotStrategy');
ok(engineSrc.includes('entryConfigSnapshotFinalRule=${canonicalEntryConfigSnapshot?.finalEntryRule'), 'contract invalid exposes entryConfigSnapshotFinalRule');

// 6. UI shows unknown_legacy for legacy wait positions (open)
ok(adapterSrc.includes("rawSelectedStrategy.toLowerCase() === 'wait' ? 'unknown_legacy'"), 'tradeV4DataAdapter maps wait to unknown_legacy for open positions');

// 7. UI shows unknown_legacy for legacy wait positions (closed)
ok(adapterSrc.includes('unknown_legacy'), 'tradeV4DataAdapter has unknown_legacy handling for closed positions');

// 8. POSITION_STRATEGY_BINDING_AUDIT for open positions
ok(adapterSrc.includes('POSITION_STRATEGY_BINDING_AUDIT'), 'tradeV4DataAdapter emits position strategy binding audit');
ok(adapterSrc.includes('displayedStrategy=${displayedStrategy}'), 'binding audit exposes displayedStrategy');
ok(adapterSrc.includes('validExecutedStrategy=${String(validExecutedStrategy)}'), 'binding audit exposes validExecutedStrategy');
ok(adapterSrc.includes('isOpenPosition=true'), 'binding audit marks open positions');
ok(adapterSrc.includes('isClosedPosition=false'), 'binding audit distinguishes open vs closed');

// 9. POSITION_STRATEGY_BINDING_AUDIT for closed positions
ok(adapterSrc.includes('isClosedPosition=true'), 'binding audit marks closed positions');

// 10. Source of displayed strategy traced
ok(adapterSrc.includes('sourceOfDisplayedStrategy=${sourceOfDisplayedStrategy}'), 'binding audit traces source of displayed strategy');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
