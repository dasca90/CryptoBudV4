import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. EXIT_QUANTITY_RESOLUTION_AUDIT exists
ok(engineSrc.includes('EXIT_QUANTITY_RESOLUTION_AUDIT'), 'TradingEngine emits exit quantity resolution audit');

// 2. Uses paper adapter position qty
ok(engineSrc.includes("this.adapter as any).getPosition?.(coin)"), 'exit path reads paper adapter position');

// 3. Rounds sell qty using step size
ok(engineSrc.includes('Math.floor(rawSellQty / stepSize) * stepSize'), 'sell qty rounded using step size');

// 4. Falls back to paper holding if rounded > holding
ok(engineSrc.includes('paperHoldingQty > 0 && paperHoldingQty < roundedSellQty ? paperHoldingQty : roundedSellQty'), 'sell qty uses paper holding when lower');

// 5. Audit fields
ok(engineSrc.includes('paperHoldingQty=${paperHoldingQty}'), 'audit exposes paperHoldingQty');
ok(engineSrc.includes('roundedSellQty=${roundedSellQty}'), 'audit exposes roundedSellQty');
ok(engineSrc.includes('finalSellQty=${finalSellQty}'), 'audit exposes finalSellQty');
ok(engineSrc.includes('canSell=${String(canSell)}'), 'audit exposes canSell');

// 6. Blocks sell if quantity zero or below min
ok(engineSrc.includes('paper_holding_missing_for_open_position') || engineSrc.includes('EXIT_QUANTITY_RESOLUTION_FAILED'), 'blocks sell when paper holding missing');

// 7. PnL uses final sell qty (not raw pos.quantity)
ok(engineSrc.includes('const sellQty = finalSellQty > 0 ? finalSellQty : pos.quantity'), 'PnL uses resolved sell qty');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
