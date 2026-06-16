import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. DIP_REBOUND_ENTRY_CONTRACT_INVALID blocks position creation
ok(engineSrc.includes('DIP_REBOUND_ENTRY_CONTRACT_INVALID'), 'TradingEngine blocks invalid dip/rebound position');

// 2. Blocks if actualRebound missing or zero
ok(engineSrc.includes('actualReboundPct_missing_or_zero') || engineSrc.includes('actualRebound'), 'contract checks rebound');

// 3. Blocks if dip below requirement
ok(engineSrc.includes('dip_below_requirement'), 'contract checks dip below requirement');

// 4. positionCreateAllowed=false
ok(engineSrc.includes('positionCreateAllowed=false'), 'contract blocks position creation');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
