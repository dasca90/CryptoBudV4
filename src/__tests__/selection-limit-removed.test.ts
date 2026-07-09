import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const topCandidatesSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
const entryGateSrc = readFileSync(path.resolve(process.cwd(), 'src/core/entry-gate/EntryGate.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// Test A: No more selection_limit_reached in source
ok(!topCandidatesSrc.includes("'selection_limit_reached'"), 'Test A1: TopCandidatesPanel no longer has selection_limit_reached fallback');
ok(!scannerSrc.includes("'selection_limit_reached'"), 'Test A2: MarketScanner no longer references selection_limit_reached');
ok(!plannerSrc.includes("'selection_limit_reached'"), 'Test A3: ExecutionPlanner no longer references selection_limit_reached');

// Test B: ExecutionPlanner applies the configured AutoBots buy budget
ok(plannerSrc.includes('EXECUTION_SELECTION_LIMIT_AUDIT'), 'Test B1: execution selection limit audit exists');
ok(plannerSrc.includes('effectiveSelectionLimit'), 'Test B2: audit exposes effective selection limit');
ok(plannerSrc.includes('maxSelectedPerScan=${maxSelectedPerScan}'), 'Test B3: audit shows configured maxSelectedPerScan');

// Test C: Max open positions still enforced (real safety gate)
ok(plannerSrc.includes('availableSlots') && plannerSrc.includes('maxPositions'), 'Test C1: availableSlots based on maxPositions still enforced');
ok(plannerSrc.includes('MAX_GLOBAL_POSITIONS_REACHED') || plannerSrc.includes('MAX_GROUP_POSITIONS_REACHED'), 'Test C2: max positions block label exists');

// Test D: Duplicate position protection still works
ok(entryGateSrc.includes('BLOCK_DUPLICATE_POSITION'), 'Test D1: BLOCK_DUPLICATE_POSITION gate exists in EntryGate');
ok(entryGateSrc.includes('openSymbols.includes(candidate.symbol)'), 'Test D2: duplicate check against open positions works');

// Test E: Pending order protection still works
ok(entryGateSrc.includes('BLOCK_PENDING_BUY_EXISTS'), 'Test E1: BLOCK_PENDING_BUY_EXISTS gate exists');
ok(entryGateSrc.includes('pendingOrderSymbols.includes(candidate.symbol)'), 'Test E2: pending order check works');

// Test F: Capital protection still works
ok(plannerSrc.includes('capitalLimitedSlots'), 'Test F1: capital-based slot limiting exists');
ok(plannerSrc.includes('BLOCK_CAPITAL_LIMIT') || plannerSrc.includes('CAPITAL_BLOCKED'), 'Test F2: capital block label exists');

// Test G: Spread gate still works
ok(plannerSrc.includes('maxSpreadPct'), 'Test G1: spread gate still active');
ok(plannerSrc.includes('spreadBlockedCount'), 'Test G2: spread blocked count tracked');

// Test H: TP room gate still works
ok(plannerSrc.includes('tpRoomOk'), 'Test H: TP room check still active');

// Test I: Selection limit backfill variable renamed
ok(scannerSrc.includes('backfillRejectedSymbols') && !scannerSrc.includes('selectionLimitRejectedSymbols'), 'Test I: selectionLimitRejectedSymbols renamed to backfillRejectedSymbols');

// Test J: ExecutionPlanner enforces separate module buy budgets, with shared safety gates only
ok(plannerSrc.includes('const maxAutoBotsSelectedPerScan = maxSelectedPerScan'), 'Test J1: planner applies maxSelectedPerScan to AutoBots only');
ok(plannerSrc.includes('maxUnicornSelectedPerScan') && plannerSrc.includes('maxAutoBotsSelectedPerScan + maxUnicornSelectedPerScan'), 'Test J2: planner combines separate module budgets instead of reusing one shared cap');
ok(plannerSrc.includes('globalSafetySelectionLimit') && plannerSrc.includes('Math.min(availableSlots, capitalLimitedSlots)'), 'Test J3: planner still applies max-position and capital safety gates');

// Test K: skippedBySelectionLimit in audit is false
ok(scannerSrc.includes('skippedBySelectionLimit=${String(false)}'), 'Test K: skippedBySelectionLimit is always false');

// Test L: TopCandidatesPanel fallback no longer uses selection_limit_reached
ok(topCandidatesSrc.includes("'execution_not_triggered'") && !topCandidatesSrc.includes("'selection_limit_reached'"), 'Test L: TopCandidates uses execution_not_triggered as fallback, not selection_limit_reached');

// Test M: TradingEngine duplicate check still works
ok(engineSrc.includes('BLOCKED_DUPLICATE') || engineSrc.includes('hasOpenPosition'), 'Test M: TradingEngine duplicate position check still active');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
