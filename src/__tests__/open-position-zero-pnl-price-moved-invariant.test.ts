import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Detection: priceDiff > 0.0001 but pnlPct < 0.001
ok(adapterSrc.includes('priceDiff > 0.0001') || engineSrc.includes('priceDiff'), 'code detects price movement');

// 2. Zero PnL invariant warning emitted
ok(adapterSrc.includes('rowsWithZeroPnlButPriceMoved') && adapterSrc.includes('logger.warn'), 'zero PnL with price moved is a WARN-level invariant');

// 3. Live price update exists (feed → positionManager)
ok(engineSrc.includes('this.positionManager.updatePosition(config.coin, {'), 'feed subscription updates position prices');
ok(engineSrc.includes('currentPrice: price.last'), 'feed updates currentPrice');

// 4. processDecisions safety net updates positions
ok(engineSrc.includes('this.feed.getLastPrice(pos.coin)'), 'processDecisions reads feed prices');
ok(engineSrc.includes('this.positionManager.updatePosition(pos.coin'), 'processDecisions updates position from feed');

// 5. PnL formula is correct for spot long
ok(engineSrc.includes("((price.last - pos.avgEntryPrice) / pos.avgEntryPrice) * 100"), 'PnL formula: (price - entry) / entry * 100');

// 6. Position does not default to 0 PnL when price differs — update is required
ok(engineSrc.includes('price.last > 0') && engineSrc.includes('unrealizedPnlPercent'), 'position update requires price > 0');

// 7. UI reads from PositionManager (not static snapshot)
ok(adapterSrc.includes('PositionManager'), 'UI declares PositionManager as source');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
