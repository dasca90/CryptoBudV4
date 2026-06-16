import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. EXECUTION_BLOCK_REASON_CANONICAL_AUDIT exists
ok(engineSrc.includes('EXECUTION_BLOCK_REASON_CANONICAL_AUDIT'), 'TradingEngine emits canonical block reason audit');

// 2. Audit fields
ok(engineSrc.includes('phase=${!adapterWasCalled'), 'canonical audit exposes phase');
ok(engineSrc.includes('adapterCalled=${String(adapterWasCalled)}'), 'canonical audit exposes adapterCalled');
ok(engineSrc.includes('riskBlockReasons=${this.lastRiskBlockReason'), 'canonical audit exposes riskBlockReasons');
ok(engineSrc.includes('finalRejectReasonBefore=PAPER_REJECT_INSUFFICIENT_POSITION_QTY'), 'canonical audit shows PAPER_REJECT_ prefix');
ok(engineSrc.includes('finalRejectReasonAfter=${failReason'), 'canonical audit exposes final reject reason');
ok(engineSrc.includes('canonicalReasonSource=${this.lastRiskBlockReason'), 'canonical audit exposes reason source');

// 3. risk_blocked prefix preserved in failReason
ok(engineSrc.includes('risk_blocked:') && engineSrc.includes('lastRiskBlockReason'), 'fail reason preserves risk_blocked prefix');

// 4. PAPER_REJECT only when adapter was called
ok(engineSrc.includes('finalRejectReasonBefore=PAPER_REJECT_INSUFFICIENT_POSITION_QTY'), 'canonical audit tracks PAPER_REJECT prefix');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
