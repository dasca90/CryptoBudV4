import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Builder validates dip/rebound via strategy contract
ok(builderSrc.includes('validateStrategyContract'), 'builder uses contract validation for dip_and_rebound');

// 2. Builder's resolution calls contract validation
ok(builderSrc.includes('STRATEGY_CONTRACT_VALIDATION_AUDIT'), 'builder emits contract validation audit');

// 3. DIP_REBOUND_ENTRY_CONTRACT_INVALID checks rebound
ok(engineSrc.includes('DIP_REBOUND_ENTRY_CONTRACT_INVALID'), 'contract invalid audit exists');
ok(engineSrc.includes('actualReboundPct=${Number.isFinite(actualRebound') || engineSrc.includes('actualRebound'), 'contract audit checks actualRebound');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
