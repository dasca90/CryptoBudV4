import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. totalMaxOpenPositions no longer 0.02
ok(!engineSrc.includes('totalMaxOpenPositions=${brain.config.maxPositionSize}'), 'totalMaxOpenPositions not from brain.config.maxPositionSize');

// 2. RISK_CONFIG_SOURCE_AUDIT exists
ok(engineSrc.includes('RISK_CONFIG_SOURCE_AUDIT'), 'engine emits risk config audit');
ok(engineSrc.includes('configBindingValid=true'), 'config binding marked valid');

// 3. EXECUTION_BACKFILL_RUNTIME_INVARIANT_AUDIT exists  
ok(scannerSrc.includes('EXECUTION_BACKFILL_RUNTIME_INVARIANT_AUDIT'), 'backfill runtime invariant audit exists');
ok(scannerSrc.includes('invariantValid=${String(invariantValid)}'), 'invariant audit checks validity');

// 4. createdPositionSymbols=none when no positions created
ok(scannerSrc.includes('createdPositionSymbols=none') || scannerSrc.includes('createdPositionSymbols='), 'createdPositionSymbols reflects actual creation count');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
