import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
};

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const engineSrc = readFileSync('src/core/trading/TradingEngine.ts', 'utf8');
const appSrc = readFileSync('src/App.tsx', 'utf8');
const typesSrc = readFileSync('src/core/types/index.ts', 'utf8');

// TRADE accounting: a successful paper BUY must produce one canonical TRADE audit per position.
ok(engineSrc.includes('private emittedBuyTradeAuditPositionIds = new Set<string>();'), 'P1 trade audit position dedupe set exists');
ok(engineSrc.includes('TRADE_BUY_EXECUTED_AUDIT:'), 'P2 canonical paper buy executed audit exists');
ok(engineSrc.includes('logger.trade(\r\n          `TRADE_BUY_EXECUTED_AUDIT:'), 'P3 paper buy audit is emitted at TRADE level');
ok(engineSrc.includes('logCategory=TRADE'), 'P4 buy audit carries logCategory=TRADE');
ok(engineSrc.includes('positionId=${tradeId}'), 'P5 buy audit includes positionId');
ok(engineSrc.includes('journalPersisted=${String(journalRecordSucceeded)}'), 'P6 buy audit includes journal persistence');
ok(engineSrc.includes('positionManagerOpenCountAfter=${openCountAfterTrade}'), 'P7 buy audit includes position manager open count');
ok(engineSrc.includes('TRADE_BUY_EXECUTED_AUDIT_DUPLICATE_SUPPRESSED'), 'P8 duplicate buy trade audit is suppressed');
ok(!engineSrc.includes('logger.trade(`ENTER ${coin}'), 'P9 legacy ENTER line no longer increments TRADE count');

// Submit accounting: submitAttempted means adapter call, while attemptedSymbols means controller/revalidation receipt.
ok(scannerSrc.includes('const submitAttemptedSymbols: string[] = [];'), 'S1 submitAttemptedSymbols is tracked separately');
ok(scannerSrc.includes('submitAttemptedCount = submitAttemptedSymbols.length;'), 'S2 submitAttemptedCount is adapter-submit count');
ok(scannerSrc.includes('submitAttempted === adapterCalled'), 'S3 per-candidate invariant ties submitAttempted to adapterCalled');
ok(scannerSrc.includes('EXECUTION_ATTEMPT_OUTCOME_AUDIT:'), 'S4 per-candidate outcome audit exists');
ok(scannerSrc.includes('EXECUTION_ATTEMPT_SUMMARY_AUDIT:'), 'S5 execution attempt summary audit exists');
ok(scannerSrc.includes('adapterSubmittedCandidates=${submitAttemptedSymbols.length}'), 'S6 adapterSubmittedCandidates uses submitAttemptedSymbols');
ok(scannerSrc.includes('controllerReceivedCount=${attemptedSymbols.length}'), 'S7 controllerReceivedCount remains separate');
ok(scannerSrc.includes('controllerReceivedSymbols=${attemptedSymbols.join'), 'S8 controller received symbols are explicit');
ok(scannerSrc.includes('submitAttemptedSymbols=${submitAttemptedSymbols.join'), 'S9 submit attempted symbols are explicit');
ok(!scannerSrc.includes('adapterSubmittedCandidates=${controllerReceivedCount}'), 'S10 adapter submitted is not aliased to controllerReceivedCount');

// The execution result handoff exposes ids produced by the real submit/fill path.
ok(typesSrc.includes('orderId?: string;'), 'R1 PaperAutoExecutionResult includes orderId');
ok(typesSrc.includes('positionId?: string;'), 'R2 PaperAutoExecutionResult includes positionId');
ok(engineSrc.includes('positionId: created ? createdPosition?.tradeId : undefined'), 'R3 default paper handler returns created positionId only after creation');
ok(appSrc.includes('positionId: created ? createdPosition?.tradeId : undefined'), 'R4 app paper handler returns created positionId only after creation');

// WARN cleanup: expected pre-adapter/no-submit paths are informational; fill-without-position remains actionable WARN.
ok(engineSrc.includes('EXECUTION_PRE_ADAPTER_REJECTION_AUDIT:') && engineSrc.includes('severity=INFO actionable=false invariantOk=true failureReason=none'), 'W1 pre-adapter rejection is INFO diagnostic');
ok(appSrc.includes('const positionFailureIsInvariant = adapterWasCalled && !!lastPaperExec?.success;'), 'W2 fill without position is the WARN boundary');
ok(appSrc.includes("severity=${positionFailureIsInvariant ? 'WARN' : 'INFO'}"), 'W3 position create audit severity is conditional');
ok(appSrc.includes("failureReason=${positionFailureIsInvariant ? 'FILL_WITHOUT_POSITION_CREATED' : 'none'}"), 'W4 non-fill/no-submit position create audit has no failure reason');
ok(engineSrc.includes('STRATEGY_DOWNGRADE_RECONCILED_AUDIT:') && engineSrc.includes('severity=INFO actionable=false invariantOk=true failureReason=none'), 'W5 expected strategy repair audit is INFO');
ok(engineSrc.includes('AUTOSTRATEGY_ROUTER_INVALID_OUTPUT_REPAIRED:') && engineSrc.includes('severity=INFO actionable=false invariantOk=true failureReason=none'), 'W6 router repair audit is INFO when repaired safely');

console.log(`post-buy-execution-accounting: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
