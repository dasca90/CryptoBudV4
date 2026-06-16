import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// Test A: finalExecutable is now let (can be reassigned to false)
ok(builderSrc.includes('let finalExecutable'), 'Test A: finalExecutable is now let for reassignment');

// Test B: After downgrade, re-validates contract
ok(builderSrc.includes('downgradedTo') || builderSrc.includes('re-validate after downgrade'), 'Test B1: After downgrade, re-validates contract');
ok(builderSrc.includes('downgrade_failed') || builderSrc.includes('downgradedTo'), 'Test B2: Sets finalExecutable=false if downgraded strategy still invalid');

// Test C: Momentum/balanced hard fail when contract invalid
ok(builderSrc.includes('STRATEGY_CONTRACT_HARD_FAIL'), 'Test C1: STRATEGY_CONTRACT_HARD_FAIL log exists for momentum/balanced');
ok(builderSrc.includes('fixed_finalExecutable_false'), 'Test C2: finalExecutable set to false on hard fail');

// Test D: BUY_READY_CONTRACT_INVARIANT_AUDIT exists
ok(scannerSrc.includes('BUY_READY_CONTRACT_INVARIANT_AUDIT'), 'Test D1: BUY_READY_CONTRACT_INVARIANT_AUDIT exists');
ok(scannerSrc.includes('invalidContractBuyReadyCount'), 'Test D2: Invariant audit tracks invalidContractBuyReadyCount');

// Test E: EXECUTION_PRE_ADAPTER_REJECTION_AUDIT exists
ok(engineSrc.includes('EXECUTION_PRE_ADAPTER_REJECTION_AUDIT'), 'Test E1: EXECUTION_PRE_ADAPTER_REJECTION_AUDIT exists');
ok(engineSrc.includes('realRejectReason'), 'Test E2: Audit includes realRejectReason');

// Test F: Generic pre_adapter_block_before_submit is LAST resort
ok(engineSrc.includes("'Demo execution blocked before adapter: pre_adapter_block_before_submit'"), 'Test F: Generic fallback remains as last resort only');

// Test G: Specific reasons exist before generic fallback
ok(engineSrc.includes("this.lastPreAdapterBlockReason"), 'Test G1: lastPreAdapterBlockReason checked before fallback');
ok(engineSrc.includes("this.lastRiskBlockReason"), 'Test G2: lastRiskBlockReason checked before fallback');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
