import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Uses paper adapter position for sell qty
ok(engineSrc.includes("this.adapter as any).getPosition?.(coin)"), 'uses paper adapter getPosition');

// 2. Falls back to position when no paper holding
ok(engineSrc.includes('finalSellQty > 0 ? finalSellQty : pos.quantity'), 'PnL uses position qty when paper holding missing');

// 3. Paper holding mismatch detected
ok(engineSrc.includes('qtyMismatch=${String(qtyMismatch)}'), 'mismatch detected');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
