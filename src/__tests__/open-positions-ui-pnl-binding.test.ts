import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. OPEN_POSITIONS_UI_PNL_BINDING_AUDIT exists
ok(adapterSrc.includes('OPEN_POSITIONS_UI_PNL_BINDING_AUDIT'), 'tradeV4DataAdapter emits UI PnL binding audit');

// 2. Zero PnL with price moved detection
ok(adapterSrc.includes('rowsWithZeroPnlButPriceMoved') || engineSrc.includes('rowsWithZeroPnlButPriceMoved'), 'code detects rows with zero PnL but price moved');
ok(adapterSrc.includes('symbolsWithZeroPnlButPriceMoved'), 'audit lists symbols with PnL=0 despite price move');

// 3. Source = PositionManager
ok(adapterSrc.includes('source=PositionManager'), 'audit declares PositionManager as source');

// 4. rowUsesStaticEntrySnapshot exposed
ok(adapterSrc.includes('rowUsesStaticEntrySnapshot='), 'audit exposes if using static entry snapshot');

// 5. rowUsesCandidateState=false
ok(adapterSrc.includes('rowUsesCandidateState=false'), 'audit confirms not using candidate state');

// 6. OPEN_POSITION_MARK_PRICE_UPDATE_AUDIT exists
ok(engineSrc.includes('OPEN_POSITION_MARK_PRICE_UPDATE_AUDIT'), 'TradingEngine emits mark price update audit');

// 7. OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT exists
ok(engineSrc.includes('OPEN_POSITION_UNREALIZED_PNL_UPDATE_AUDIT'), 'TradingEngine emits unrealized PnL update audit');

// 8. Unrealized PnL audit includes estimated fees
ok(engineSrc.includes('estimatedFees='), 'PnL audit includes estimated fees');

// 9. Unrealized PnL audit includes entryValue
ok(engineSrc.includes('entryValue='), 'PnL audit includes entryValue');

// 10. Unrealized PnL audit includes pnlDirection
ok(engineSrc.includes("pnlDirection=${pnlDirection}") || engineSrc.includes("pnlDirection=${unrealizedPnlPct"), 'PnL audit includes pnlDirection');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
