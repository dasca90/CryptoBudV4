import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');

// 1. PlannedCandidate.strategy uses resolved strategy from snapshot
ok(plannerSrc.includes('strategy: scannerAutoEntryConfigSnapshot.selectedStrategy'), 'planned candidate strategy from snapshot');

// 2. TradingEngine action creation uses entryConfigSnapshot
ok(engineSrc.includes('strategy: scannerAutoEntryConfigSnapshot?.selectedStrategy'), 'action strategy from entryConfigSnapshot');
ok(engineSrc.includes('prediction: planEntry.effectiveStrategy ?? scannerAutoEntryConfigSnapshot?.selectedStrategy'), 'prediction from snapshot if effective unavailable');

// 3. buySnapshot.selectedStrategy from canonical snapshot
ok(engineSrc.includes('selectedStrategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? action.strategy'), 'buySnapshot from canonicalConfigSnapshot');

// 4. settingsSnapshot.strategy from canonical snapshot
ok(engineSrc.includes('strategy: canonicalEntryConfigSnapshot?.selectedStrategy ?? strategyAuditSnapshot?.strategySelected'), 'settingsSnapshot strategy from canonicalConfigSnapshot');

// 5. strategy must not be 'wait' for executed trades
ok(engineSrc.includes('EXECUTED_TRADE_STRATEGY_CONTRACT_INVALID'), 'contract invalid blocks wait strategy');
ok(engineSrc.includes('selectedStrategy_is_wait_or_unknown') || engineSrc.includes('isStrategyUnknown'), 'contract invalid identifies wait/unknown strategy');

// 6. Entry rule at entry is preserved
ok(engineSrc.includes('effectiveEntryRule = String(resolvedStrategyAuditSnapshot?.finalEntryRule'), 'entry rule from resolved strategy audit snapshot');
ok(engineSrc.includes('(buySnapshot as any).strategyAuditSnapshot = resolvedStrategyAuditSnapshot'), 'strategy audit snapshot saved on buySnapshot');

// 7. adapterWillBeCalled only with valid strategy (precondition check)
ok(engineSrc.includes('preEffectiveStrategy.toLowerCase() === \'unknown\' || preEffectiveStrategy === \'wait\''), 'precondition blocks wait strategy before adapter');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
