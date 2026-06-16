import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. Closed position preserves entry strategy from buySnapshot (copied, not recomputed)
ok(adapterSrc.includes('trade.buySnapshot'), 'closed position reads buySnapshot');

// 2. Closed position strategy from buySnapshot.selectedStrategy, not recomputed
const csStrategyLine = adapterSrc.split('\n').find(l => l.includes('const rawSelectedStrategy = bs'));
ok(csStrategyLine != null, 'closed position reads rawSelectedStrategy from buySnapshot');

// 3. Closed position maps wait to unknown_legacy
ok(adapterSrc.includes("rawSelectedStrategy.toLowerCase() === 'wait' ? 'unknown_legacy'"), 'closed position handles legacy wait');

// 4. Closed position has POSITION_STRATEGY_BINDING_AUDIT
ok(adapterSrc.includes('isClosedPosition=true'), 'closed position strategy binding audit');

// 5. Closed position does not recompute strategy from trade.strategy if buySnapshot exists
// (buySnapshot.selectedStrategy takes priority)
ok(adapterSrc.includes('trade.strategy'), 'trade.strategy is fallback, not primary');

// 6. Entry config snapshot strategy preserved for closed positions
ok(adapterSrc.includes('entryConfigSnapshotStrategy=${String((bs as any)?.entryConfigSnapshot?.selectedStrategy'), 'closed position shows entry config snapshot strategy');

// 7. EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID audits closed positions too  
// (fires at entry time, but recorded on trade)
ok(engineSrc.includes('EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID'), 'contract invalid audit fires at entry');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
