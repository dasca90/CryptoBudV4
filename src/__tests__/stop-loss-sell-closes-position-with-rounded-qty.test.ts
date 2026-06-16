import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. SL sell qty uses rounded qty via Math.floor
ok(engineSrc.includes('Math.floor(rawSellQty / stepSize) * stepSize'), 'SL rounded qty uses Math.floor with step size');

// 2. Sell uses finalSellQty (rounded + paper-matched)
ok(engineSrc.includes('finalSellQty > 0 ? finalSellQty : pos.quantity'), 'sell qty uses resolved finalSellQty');

// 3. Paper holding used when available
ok(engineSrc.includes("paperHoldingQty > 0 && paperHoldingQty < roundedSellQty ? paperHoldingQty"), 'paper holding preferred when lower than rounded');

// 4. PositionManager closed via normal path
ok(engineSrc.includes('this.positionManager.closePosition(coin, snapshot)'), 'positionManager closed after sell');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
