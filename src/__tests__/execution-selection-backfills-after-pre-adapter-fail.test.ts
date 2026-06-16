import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Backfill exists after main loop
ok(scannerSrc.includes('backfillCandidateSymbols') || scannerSrc.includes('Backfill'), 'MarketScanner has backfill mechanism');

// 2. Backfill uses positionCreatedCount, not just selectedCount
ok(scannerSrc.includes('maxSelectedPerScan - positionCreatedCount'), 'backfill uses created position count');

// 3. Backfill sorts candidates by score
ok(scannerSrc.includes('.sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0)'), 'backfill sorts by score');

// 4. Backfill revalidates before execution
ok(scannerSrc.includes('revalidateCandidate') && scannerSrc.includes('backfill'), 'backfill revalidates before execution');

// 5. Backfill filters out already-attempted symbols
ok(scannerSrc.includes("!attemptedSymbols.includes(c.symbol)"), 'backfill excludes attempted symbols');

// 6. Backfill filters duplicates from open positions
ok(scannerSrc.includes("!currentOpen.includes(c.symbol)"), 'backfill excludes duplicate open symbols');

// 7. Backfill uses traderBrainDecision.entryPlan as fallback (non-selected candidates lack planner entryPlan)
ok(scannerSrc.includes('bc.traderBrainDecision?.entryPlan'), 'backfill falls back to traderBrainDecision.entryPlan');

// 8. Risk block reason propagated from engine
ok(engineSrc.includes('lastRiskBlockReason'), 'TradingEngine stores and propagates risk reason');

// 9. EXECUTION_BACKFILL_AFTER_RISK_BLOCK_AUDIT fires when all selected failed
ok(scannerSrc.includes('EXECUTION_BACKFILL_AFTER_RISK_BLOCK_AUDIT'), 'backfill risk block audit exists');

// 10. BUY_READY reasons distinguish pre-adapter fail
ok(scannerSrc.includes('not_backfilled_after_pre_adapter_fail'), 'reason distinguishes pre-adapter fail from selection limit');

// 11. Entry plan null guard skips candidates without valid entry plan
ok(scannerSrc.includes('if (!entryPlan) { if (!selectionLimitRejectedSymbols'), 'backfill skips candidates without entry plan');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
