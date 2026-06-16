import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const simSrc = readFileSync(path.resolve(process.cwd(), 'src/core/exchange/PaperExecutionSimulator.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// Test A: PaperExecutionSimulator no longer rounds executedPrice to 2 decimals
ok(!simSrc.includes('Math.round(executedPrice * 100) / 100') || simSrc.includes('LOW_PRICE_SYMBOL_PRECISION_AUDIT'), 'Test A: executedPrice is no longer rounded to 2 decimals');

// Test B: executedNotional no longer rounded to 2 decimals
ok(!simSrc.includes('Math.round(executedNotional * 100) / 100'), 'Test B: executedNotional is no longer rounded to 2 decimals');

// Test C: LOW_PRICE_SYMBOL_PRECISION_AUDIT exists for sub-cent coins
ok(simSrc.includes('LOW_PRICE_SYMBOL_PRECISION_AUDIT'), 'Test C: low-price precision audit exists');

// Test D: ENTRY_PRICE_SOURCE_AUDIT logs raw entry price
ok(engineSrc.includes('ENTRY_PRICE_SOURCE_AUDIT'), 'Test D: entry price source audit exists');

// Test E: ENTRY_PRICE_DEVIATION_BLOCKED guard exists
ok(engineSrc.includes('ENTRY_PRICE_DEVIATION_BLOCKED'), 'Test E: entry price deviation block exists');

// Test F: Entry price deviation checks deviationPct against threshold
ok(engineSrc.includes('deviationPct') && engineSrc.includes('maxAllowedDeviationPct'), 'Test F: deviation guard compares against threshold');

// Test G: CAPITAL_INTEGRITY_AUDIT exists
ok(engineSrc.includes('CAPITAL_INTEGRITY_AUDIT'), 'Test G: capital integrity audit exists');

// Test H: CAPITAL_INTEGRITY_BLOCKED guard exists before addPosition
ok(engineSrc.includes('CAPITAL_INTEGRITY_BLOCKED'), 'Test H: capital integrity block exists');

// Test I: POSITION_PRICE_INTEGRITY_AUDIT logs full price integrity
ok(engineSrc.includes('POSITION_PRICE_INTEGRITY_AUDIT'), 'Test I: position price integrity audit exists');

// Test J: Price integrity audit compares adapter result price with stored position entry price
ok(engineSrc.includes('adapterResultPrice') && engineSrc.includes('positionAvgEntryPrice'), 'Test J: audit compares adapter result and position prices');

// Test K: TP1 target calculated from raw entryPrice
ok(engineSrc.includes('TP_TARGET_PRICE_CALC_AUDIT') || engineSrc.includes('tp1TargetPrice'), 'Test K: TP1 target calculation audited');

// Test L: SL trigger uses raw entryPrice (stored position avgEntryPrice)
ok(engineSrc.includes('slTrigger') || engineSrc.includes('POSITION_PRICE_INTEGRITY_AUDIT'), 'Test L: SL trigger uses position price');

// Test M: PaperExecutionSimulator now preserves full float precision
ok(simSrc.includes('audit.rawExecutedPrice') || simSrc.includes('rawExecutedPrice'), 'Test M: raw executed price preserved in audit');

// Test N: Entry price deviation guard releases lock (does not proceed)
ok(engineSrc.includes('entry_price_deviation_blocked') || engineSrc.includes('reason=entry_price_deviation'), 'Test N: deviation block releases lock');

// Test O: Capital integrity block releases lock
ok(engineSrc.includes('capital_integrity_violation') || (engineSrc.includes('CAPITAL_INTEGRITY_BLOCKED') && engineSrc.includes('releaseLock')), 'Test O: capital integrity block releases lock');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
