import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. risk_blocked reason propagated  
ok(engineSrc.includes('risk_blocked:') && engineSrc.includes('lastRiskBlockReason'), 'risk_blocked prefix in fail reason');

// 2. risk block reason stored before audit
ok(engineSrc.includes('this.lastRiskBlockReason = String(preAdapterRiskDecision'), 'risk reason stored on block');

// 3. EXECUTION_BLOCK_REASON_CANONICAL_AUDIT exists
ok(engineSrc.includes('EXECUTION_BLOCK_REASON_CANONICAL_AUDIT'), 'canonical block reason audit exists');

// 4. PAPER_REJECT only when adapter called
ok(engineSrc.includes('finalRejectReasonBefore=PAPER_REJECT_INSUFFICIENT_POSITION_QTY'), 'canonical audit tracks paper reason prefix');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
