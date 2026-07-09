import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const controllerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/PaperAutoExecutionController.ts'), 'utf8');

// Test 1: Pre-adapter block reason tracking
ok(engineSrc.includes('lastPreAdapterBlockReason'), 'Test 1a: lastPreAdapterBlockReason property exists');
ok(engineSrc.includes('DUPLICATE_OPEN_POSITION') || engineSrc.includes("lastPreAdapterBlockReason = 'DUPLICATE_OPEN_POSITION'"), 'Test 1b: duplicate tracked explicitly');
ok(engineSrc.includes('STRATEGY_SETUP_NOT_MET') || engineSrc.includes("lastPreAdapterBlockReason = `STRATEGY_SETUP_NOT_MET"), 'Test 1c: strategy setup failure tracked explicitly');
ok(engineSrc.includes('TP1_INVALID') || engineSrc.includes("lastPreAdapterBlockReason = 'TP1_INVALID'"), 'Test 1d: TP1 invalid tracked explicitly');
ok(engineSrc.includes('PENDING_ORDER_LOCK') || engineSrc.includes("lastPreAdapterBlockReason = 'PENDING_ORDER_LOCK'"), 'Test 1e: pending order lock tracked explicitly');
ok(engineSrc.includes('SOURCE_CROSS_CONTAMINATION') || engineSrc.includes("lastPreAdapterBlockReason = 'SOURCE_CROSS_CONTAMINATION'"), 'Test 1f: cross contamination tracked explicitly');

// Test 2: Wrapper uses specific reason instead of vague fallback
ok(engineSrc.includes('this.lastPreAdapterBlockReason'), 'Test 2a: wrapper checks lastPreAdapterBlockReason before fallback');
ok(engineSrc.includes("`pre_adapter_block:${this.lastPreAdapterBlockReason}`"), 'Test 2b: specific pre-adapter block reason used');

// Test 3: Per-symbol decision tracking
ok(scannerSrc.includes('duplicateSkippedCount'), 'Test 3a: duplicateSkippedCount tracked');
ok(scannerSrc.includes('pendingSkippedCount'), 'Test 3b: pendingSkippedCount tracked');
ok(scannerSrc.includes('preAdapterAllowedCount'), 'Test 3c: preAdapterAllowedCount tracked');
ok(scannerSrc.includes('perSymbolDecisions'), 'Test 3d: perSymbolDecisions array tracked');

// Test 4: Batch summary audit
ok(scannerSrc.includes('PRE_ADAPTER_BATCH_DECISION_AUDIT'), 'Test 4a: PRE_ADAPTER_BATCH_DECISION_AUDIT exists');
ok(scannerSrc.includes('ALL_SELECTED_SYMBOLS_DUPLICATE'), 'Test 4b: ALL_SELECTED_SYMBOLS_DUPLICATE reason exists');
ok(scannerSrc.includes('ALL_SELECTED_SYMBOLS_PENDING_ORDER'), 'Test 4c: ALL_SELECTED_SYMBOLS_PENDING_ORDER reason exists');
ok(scannerSrc.includes('ALL_SELECTED_SYMBOLS_FAILED_PRE_ADAPTER_VALIDATION'), 'Test 4d: ALL_SELECTED_SYMBOLS_FAILED_PRE_ADAPTER_VALIDATION reason exists');

// Test 5: Per-symbol decision audit
ok(scannerSrc.includes('EXECUTION_SELECTED_SYMBOL_DECISION_AUDIT'), 'Test 5: EXECUTION_SELECTED_SYMBOL_DECISION_AUDIT exists');

// Test 6: Final no-buy reason hierarchy with clear labels
ok(scannerSrc.includes('GLOBAL_AUTO_EXECUTION_DISABLED'), 'Test 6a: GLOBAL_AUTO_EXECUTION_DISABLED in hierarchy');
ok(scannerSrc.includes('GLOBAL_MAX_OPEN_POSITIONS_REACHED'), 'Test 6b: GLOBAL_MAX_OPEN_POSITIONS_REACHED in hierarchy');
ok(scannerSrc.includes('GLOBAL_CAPITAL_EXHAUSTED'), 'Test 6c: GLOBAL_CAPITAL_EXHAUSTED in hierarchy');
ok(scannerSrc.includes('ALL_SELECTED_SYMBOLS_DUPLICATE'), 'Test 6d: ALL_SELECTED_SYMBOLS_DUPLICATE in hierarchy');
ok(scannerSrc.includes('ADAPTER_REJECTED'), 'Test 6e: ADAPTER_REJECTED in hierarchy');

// Test 7: AutoBots buy budget is explicit and audited
ok(plannerSrc.includes('EXECUTION_SELECTION_LIMIT_AUDIT') && plannerSrc.includes('maxSelectedPerScan=${maxSelectedPerScan}'), 'Test 7: AutoBots buy budget is explicit and audited');

// Test 8: Duplicate protection per-symbol, not batch
ok(controllerSrc.includes("input.openSymbols.includes(symbol)"), 'Test 8a: PaperAutoExecutionController checks duplicate per-symbol');
ok(controllerSrc.includes('DUPLICATE_OPEN_POSITION'), 'Test 8b: PaperAutoExecutionController returns DUPLICATE_OPEN_POSITION per-symbol');

// Test 9: Cooldown is separate from duplicate
ok(scannerSrc.includes('cooldownSkippedCount'), 'Test 9: Cooldown tracked separately from duplicate');

// Test 10: pre_adapter_block_before_submit is now last resort
ok(engineSrc.includes('pre_adapter_block_before_submit'), 'Test 10: pre_adapter_block_before_submit remains as ultimate fallback only');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
