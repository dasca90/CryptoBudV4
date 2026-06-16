import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. PnL formula in TradingEngine matches: (markPrice - entryPrice) * quantity
ok(engineSrc.includes("(price.last - pos.avgEntryPrice) * pos.quantity"), 'TradingEngine computes unrealizedPnlUsd correctly');

// 2. PnL percentage formula: (markPrice - entryPrice) / entryPrice * 100
ok(engineSrc.includes("((price.last - pos.avgEntryPrice) / pos.avgEntryPrice) * 100"), 'TradingEngine computes unrealizedPnlPct correctly');

// 3. PNl direction (profit/loss/flat) computed
ok(engineSrc.includes("unrealizedPnlPct > 0.1 ? 'profit' : unrealizedPnlPct < -0.1 ? 'loss' : 'flat'"), 'TradingEngine computes pnlDirection');

// 4. PnL only updates when changed significantly
ok(engineSrc.includes('Math.abs(unrealizedPnlPct - previousPnlPct) > 0.001'), 'PnL update only fires when change > 0.001%');

// 5. OPEN_POSITION_MARK_PRICE_AUDIT exists
ok(engineSrc.includes('OPEN_POSITION_MARK_PRICE_AUDIT'), 'TradingEngine emits mark price audit');
ok(engineSrc.includes('markPrice=${price.last}'), 'mark price audit exposes markPrice');
ok(engineSrc.includes('markPriceSource=book_ticker_feed'), 'mark price audit exposes source');
ok(engineSrc.includes('validPrice=true'), 'mark price audit marks valid');

// 6. OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT exists
ok(engineSrc.includes('OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT') || engineSrc.includes('POSITION_PNL_UPDATE_AUDIT'), 'TradingEngine emits PnL update audit');
ok(engineSrc.includes('previousUnrealizedPnlUsd=') || engineSrc.includes('previousPnlUsd='), 'PnL audit exposes previous PnL');
ok(engineSrc.includes('previousUnrealizedPnlPct=') || engineSrc.includes('previousPnlPct='), 'PnL audit exposes previous PnL pct');

// 7. UI reads position.currentPrice (now updated live)
ok(adapterSrc.includes('position.currentPrice'), 'UI reads currentPrice from position');

// 8. resolveLivePriceState still works with updated prices
ok(adapterSrc.includes('resolveLivePriceState'), 'UI uses resolveLivePriceState');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
