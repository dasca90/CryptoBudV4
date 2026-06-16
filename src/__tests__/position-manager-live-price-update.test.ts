import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const posSrc = readFileSync(path.resolve(process.cwd(), 'src/core/positions/PositionManager.ts'), 'utf8');

// 1. TradingEngine updates position prices via MarketDataFeed subscription
ok(engineSrc.includes('price.last > 0 && this.positionManager.hasOpenPosition'), 'TradingEngine updates position price from feed subscription');

// 2. PositionManager.updatePosition receives currentPrice and lastPrice
ok(engineSrc.includes('this.positionManager.updatePosition(config.coin, {'), 'TradingEngine calls updatePosition with price data');
ok(engineSrc.includes('currentPrice: price.last'), 'updatePosition sets currentPrice');
ok(engineSrc.includes('lastPrice: price.last'), 'updatePosition sets lastPrice');

// 3. unrealizedPnlPercent computed and stored
ok(engineSrc.includes('unrealizedPnlPercent: unrealizedPnlPct'), 'updatePosition stores unrealizedPnlPercent');

// 4. PositionManager has updatePosition method
ok(posSrc.includes('updatePosition(symbol: string, patch: Partial<Position>)'), 'PositionManager has updatePosition method');

// 5. Process decisions also updates position prices (safety net)
ok(engineSrc.includes('this.positionManager.getOpenPositions()') && engineSrc.includes('this.feed.getLastPrice'), 'processDecisions updates open position prices');

// 6. PnL computed using correct formula: (markPrice - entryPrice) / entryPrice * 100
ok(engineSrc.includes("((price.last - pos.avgEntryPrice) / pos.avgEntryPrice) * 100"), 'PnL formula: (price - entry) / entry * 100');

// 7. PnL for spot long only (uses avgEntryPrice)
ok(engineSrc.includes('pos.avgEntryPrice > 0'), 'PnL check guards against zero entry price');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
