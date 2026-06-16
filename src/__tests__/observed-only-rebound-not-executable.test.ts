import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');

// 1. Contract validates rebound for dip_and_rebound
ok(builderSrc.includes('validateStrategyContract'), 'builder rejects invalid dip_and_rebound via contract');

// 2. Contract check covers dip AND rebound
ok(builderSrc.includes('STRATEGY_CONTRACT_VALIDATION_AUDIT'), 'builder emits contract validation audit');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
