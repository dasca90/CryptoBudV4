import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. OPEN_POSITIONS_UI_LIVE_BINDING_AUDIT exists
ok(adapterSrc.includes('OPEN_POSITIONS_UI_LIVE_BINDING_AUDIT'), 'tradeV4DataAdapter emits live binding audit');

// 2. Audit fields: rowsWithLivePrice, rowsWithPnlComputed, rowsWithStalePrice, rowsWithStrategyWait
ok(adapterSrc.includes('rowsWithLivePrice=${rowsWithLivePrice}'), 'live binding audit exposes rowsWithLivePrice');
ok(adapterSrc.includes('rowsWithPnlComputed=${rowsWithPnlComputed}'), 'live binding audit exposes rowsWithPnlComputed');
ok(adapterSrc.includes('rowsWithStalePrice=${rowsWithStalePrice}'), 'live binding audit exposes rowsWithStalePrice');
ok(adapterSrc.includes('rowsWithStrategyWait=${rowsWithStrategyWait}'), 'live binding audit exposes rowsWithStrategyWait');

// 3. Source = PositionManager
ok(adapterSrc.includes('source=PositionManager'), 'live binding audit declares PositionManager as source');

// 4. refreshAgeMs computed from oldest position
ok(adapterSrc.includes('refreshAgeMs=${now') || adapterSrc.includes('refreshAgeMs') || engineSrc.includes('refreshAgeMs'), 'live binding audit includes refresh age');

// 5. PositionManager is canonical source — positions come from getOpenPositions
ok(adapterSrc.includes('PositionManager'), 'UI declares PositionManager as canonical source');

// 6. TradingEngine updates position.currentPrice from feed (live)
ok(engineSrc.includes('currentPrice: price.last') && engineSrc.includes('positionManager.updatePosition'), 'TradingEngine updates position currentPrice from feed');

// 7. Not reading PnL from scanner candidate (position.currentPrice, not candidate price)
ok(adapterSrc.includes('position.currentPrice'), 'UI uses position.currentPrice (not scanner candidate) for live price');

// 8. Strategy comes from buySnapshot (already fixed), not candidate
ok(adapterSrc.includes('buySnapshot') || adapterSrc.includes('selectedStrategy'), 'UI reads strategy from buySnapshot');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
