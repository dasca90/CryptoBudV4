import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. stopLossPct comes from position, not candidate or settings snapshot
ok(engineSrc.includes('stopLossPct=${pos.stopLossPercent}') || engineSrc.includes('pos.stopLossPercent'), 'SL pct from position object');

// 2. stopTriggerPrice computed from entry price and SL pct
ok(engineSrc.includes('pos.avgEntryPrice * (1 - pos.stopLossPercent / 100)'), 'stopTriggerPrice from entryPrice * (1 - SL/100)');

// 3. stopLossSource logged as 'position'
ok(engineSrc.includes("stopLossSource=position"), 'SL source tracked');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
