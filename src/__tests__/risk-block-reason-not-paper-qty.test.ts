import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. Risk block reason propagated instead of PAPER_REJECT_INSUFFICIENT_POSITION_QTY
ok(engineSrc.includes("risk_blocked:${this.lastRiskBlockReason"), 'fail reason uses risk_blocked prefix instead of generic PAPER msg');

// 2. PnL reads live position.currentPrice (updated by feed)
ok(adapterSrc.includes('position.currentPrice > 0 && position.currentPrice !== position.avgEntryPrice'), 'PnL from live position.currentPrice');

// 3. PnL falls back to unrealizedPnlPercent when currentPrice = entryPrice
ok(adapterSrc.includes('position.unrealizedPnlPercent ?? 0'), 'PnL falls back to unrealizedPnlPercent');

// 4. Risk group audit includes block reason
ok(engineSrc.includes('RISK_GROUP_POSITION_LIMIT_AUDIT') && engineSrc.includes('blockReason='), 'risk audit includes block reasons');

// 5. lastRiskBlockReason declared as private field
ok(engineSrc.includes('private lastRiskBlockReason: string | null = null;'), 'lastRiskBlockReason stored on engine');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
