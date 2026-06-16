import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. EXIT_QUANTITY_RESOLUTION_AUDIT shows paper holding qty  
ok(engineSrc.includes('paperHoldingQty=${paperHoldingQty}'), 'audit shows paper hold qty');

// 2. Mismatch detection
ok(engineSrc.includes('qtyMismatch=${String(qtyMismatch)}'), 'audit detects qty mismatch');

// 3. Mismatch reason logged
ok(engineSrc.includes("mismatchReason=${paperHoldingQty > 0 && qtyMismatch ? 'rounding_difference_between_position_and_paper' : 'none'}"), 'mismatch reason is rounding difference');

// 4. Audit logs step size and min qty
ok(engineSrc.includes('stepSize=${stepSize}'), 'audit shows step size');
ok(engineSrc.includes('minQty=${minQty}'), 'audit shows min qty');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
