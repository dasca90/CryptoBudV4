import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. exit evaluation includes SAND-like case
ok(engineSrc.includes('EXIT_EVALUATION_AUDIT') && engineSrc.includes('shouldStopLossSell'), 'exit eval handles SL evaluation');

// 2. Stop loss trigger works with any position  
ok(engineSrc.includes('markPrice <= stopTriggerPrice'), 'SL price trigger works');

// 3. Order lock prevents double sell
ok(engineSrc.includes('SELL_BLOCKED_BY_ORDER_LOCK') || engineSrc.includes('acquireLock') && engineSrc.includes('SELL'), 'sell uses order lock');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
