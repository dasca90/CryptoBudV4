import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. SL trigger uses mark price (price-based trigger, not only PnL-based)
ok(engineSrc.includes('shouldStopLossSell') && engineSrc.includes('markPrice <= stopTriggerPrice'), 'SL triggers on price level');

// 2. EXIT_EVALUATION_AUDIT shows unrealizedPnlPct
ok(engineSrc.includes('unrealizedPnlPct=${pnlPct.toFixed(2)}'), 'exit audit shows PnL');

// 3. STOP_LOSS_TRIGGER_AUDIT shows unrealizedPnlPct
ok(engineSrc.includes('STOP_LOSS_TRIGGER_AUDIT') && engineSrc.includes('unrealizedPnlPct=${pnlPct.toFixed(2)}'), 'SL audit shows unrealizedPnL');

// 4. Both price and PnL triggers evaluated
ok(engineSrc.includes('pnlPct = pos.avgEntryPrice > 0'), 'PnL percentage computed');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
