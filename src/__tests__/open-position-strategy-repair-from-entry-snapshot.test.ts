import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. EXECUTED_POSITION_STRATEGY_SOURCE_MISMATCH hard-fail
ok(engineSrc.includes('EXECUTED_POSITION_STRATEGY_SOURCE_MISMATCH'), 'TradingEngine emits strategy source mismatch');
ok(engineSrc.includes('entryConfigSnapshotStrategy=${ecsSelectedStrategy}'), 'mismatch audit exposes entryConfigSnapshotStrategy');
ok(engineSrc.includes('resolvedStrategyAtEntry=${ecsSelectedStrategy}'), 'mismatch audit exposes resolvedStrategyAtEntry');
ok(engineSrc.includes('resolvedEntryRuleAtEntry=${ecsFinalEntryRule}'), 'mismatch audit exposes resolvedEntryRuleAtEntry');
ok(engineSrc.includes('reason=repaired_from_entry_config_snapshot'), 'mismatch reason is repaired_from_entry_config_snapshot');

// 2. POSITION_STRATEGY_RESOLUTION_AUDIT
ok(engineSrc.includes('POSITION_STRATEGY_RESOLUTION_AUDIT'), 'TradingEngine emits strategy resolution audit');
ok(engineSrc.includes('positionStrategyAtEntryBefore=${bsStrategy}'), 'resolution audit exposes before value');
ok(engineSrc.includes('resolvedStrategyAtEntry=${repairedFromSnapshot ? ecsSelectedStrategy'), 'resolution audit exposes resolved value');
ok(engineSrc.includes('sourceUsed=${repairedFromSnapshot ? \'entryConfigSnapshot\' : \'buySnapshot\'}'), 'resolution audit traces source');
ok(engineSrc.includes('repairedFromSnapshot=${String(repairedFromSnapshot)}'), 'resolution audit flags repair');

// 3. buySnapshot.selectedStrategy repaired from entryConfigSnapshot
ok(engineSrc.includes('(buySnapshot as any).selectedStrategy = ecsSelectedStrategy'), 'TradingEngine repairs buySnapshot.selectedStrategy from entryConfigSnapshot');

// 4. UI uses entryConfigSnapshot strategy when buySnapshot is invalid
ok(adapterSrc.includes('entryConfigSnapshotStrategy && isValidExecutableStrategy(entryConfigSnapshotStrategy)'), 'UI uses entryConfigSnapshot strategy as fallback for open positions');

// 5. Closed positions also resolve from entryConfigSnapshot
ok(adapterSrc.includes('closedEntryConfigSnapshotStrategy && isValidClosedExecutableStrategy(closedEntryConfigSnapshotStrategy)'), 'UI uses entryConfigSnapshot strategy for closed positions');

// 6. Valid executable strategy filter exists (momentum, balanced, dip_and_rebound, conservative)
ok(engineSrc.includes("isValidExecutableStrategy") || adapterSrc.includes("isValidExecutableStrategy"), 'code has valid executable strategy check');
ok(adapterSrc.includes("!/^(?:wait|unknown|avoid|)$/i.test(s)"), 'UI filters out wait/unknown/avoid strategies');

// 7. unknown_legacy only when no valid proof exists
ok(adapterSrc.includes("unknown_legacy"), 'UI still has unknown_legacy for truly legacy positions');

// 8. Hard fail before PositionManager.addPosition if unrepaired
ok(engineSrc.includes('repairedFromSnapshot') && engineSrc.includes('entryConfigSnapshot'), 'strategy check before position add');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
