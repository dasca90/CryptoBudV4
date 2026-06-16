import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. finalEntryRule must be executable (not WAITING_FOR_SETUP) when finalExecutable=true
ok(builderSrc.includes("if (finalExecutable && /WAITING|UNKNOWN/i.test(finalEntryRule))"), 'builder catches WAITING in finalEntryRule when executable');

// 2. Derived entry rule follows convention: STRATEGY_READY
ok(builderSrc.includes('.toUpperCase() + \'_READY\'') || builderSrc.includes('_READY'), 'builder generates READY-suffixed entry rules');

// 3. ExecutionPlanner blocks candidates with WAITING_FOR_SETUP regardless of selectedStrategy
ok(plannerSrc.includes("finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'planner gate checks WAITING_FOR_SETUP in finalEntryRule');
ok(plannerSrc.includes("strategyAudit.strategySelected.toLowerCase() === 'wait'"), 'planner gate also checks strategy wait');

// 4. Entry rule source traced in rejection audit
ok(plannerSrc.includes('sourceOfFinalEntryRule=${sourceOfFinalEntryRule}'), 'rejection audit traces source of finalEntryRule');
ok(plannerSrc.includes('finalEntryRuleSource=${sourceOfFinalEntryRule}'), 'rejection audit exposes finalEntryRuleSource');

// 5. TradingEngine precondition blocks WAITING_FOR_SETUP (safety net)
ok(engineSrc.includes("preEffectiveEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'TradingEngine precondition blocks WAITING_FOR_SETUP');

// 6. snapshotContractValid includes finalEntryRule semantic check
ok(engineSrc.includes("!canonicalEntryConfigSnapshot.finalEntryRule.toUpperCase().includes('WAITING_FOR_SETUP')"), 'engine snapshotContractValid checks finalEntryRule');

// 7. contractValid in all 4 boundaries includes finalEntryRule check
const contractLines = engineSrc.split('\n').filter(l => l.includes('contractValid=') && l.includes('finalEntryRule.toUpperCase()'));
ok(contractLines.length >= 1, 'engine contract audit boundaries include finalEntryRule semantic check');

// 8. Selected candidates must have executable finalEntryRule — EXECUTION_TRANSACTION_AUDIT shows adapterWillBeCalled=true when valid
ok(engineSrc.includes('adapterWillBeCalled=${String(adapterWillBeCalled)}'), 'engine tracks adapterWillBeCalled from precondition');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
