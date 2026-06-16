import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. RISK_CONFIG_SOURCE_AUDIT exists
ok(engineSrc.includes('RISK_CONFIG_SOURCE_AUDIT'), 'risk config audit exists');

// 2. maxPositionsPerRiskGroup exposed
ok(engineSrc.includes('maxPositionsPerRiskGroup='), 'maxPositionsPerRiskGroup exposed');

// 3. maxCapitalAtRisk exposed
ok(engineSrc.includes('maxCapitalAtRisk='), 'maxCapitalAtRisk exposed');

// 4. maxDailyTrades exposed
ok(engineSrc.includes('maxDailyTrades='), 'maxDailyTrades exposed');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
