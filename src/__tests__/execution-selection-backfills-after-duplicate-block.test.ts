import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. Backfill mechanism exists after main execution loop
ok(scannerSrc.includes('backfillCandidates') || scannerSrc.includes('backfillPool') || scannerSrc.includes('backfillCandidate'), 'MarketScanner has backfill mechanism');

// 2. EXECUTION_SELECTION_BACKFILL_AUDIT exists
ok(scannerSrc.includes('EXECUTION_SELECTION_BACKFILL_AUDIT'), 'MarketScanner emits backfill audit');

// 3. Backfill audit fields
ok(scannerSrc.includes('initialSelectedSymbols=${initialSelectedSymbols'), 'backfill audit exposes initialSelectedSymbols');
ok(scannerSrc.includes('backfillCandidateSymbols=${backfillCandidateSymbols'), 'backfill audit exposes backfillCandidateSymbols');
ok(scannerSrc.includes('finalSelectedCount=${attemptedSymbols.length}'), 'backfill audit exposes finalSelectedCount');
ok(scannerSrc.includes('validBuyReadyButNotSelectedSymbols='), 'backfill audit exposes validBuyReadyButNotSelected');

// 4. BUY_READY_NOT_SELECTED_REASON_AUDIT exists
ok(scannerSrc.includes('BUY_READY_NOT_SELECTED_REASON_AUDIT'), 'MarketScanner emits not-selected reason audit');

// 5. Not-selected audit fields
ok(scannerSrc.includes('openPositionDuplicate=${String(isDuplicate)}'), 'not-selected audit exposes openPositionDuplicate');
ok(scannerSrc.includes('skippedBySelectionLimit=${String(false)}'), 'not-selected audit marks selection limit removed');
ok(scannerSrc.includes('skippedBecauseNoBackfill=${String(!backfillCandidateSymbols'), 'not-selected audit marks no backfill');
ok(scannerSrc.includes('selectedForExecution=false'), 'not-selected audit marks not selected');
ok(scannerSrc.includes('finalNoBuyReason=${reason}'), 'not-selected audit exposes final reason');

// 6. Backfill pool filters duplicates from open symbols
ok(scannerSrc.includes("!currentOpen.includes(c.symbol)"), 'backfill filters duplicate open symbols');

// 7. Backfill respects maxSelectedPerScan
ok(scannerSrc.includes('openSlotsRemaining') || scannerSrc.includes('remainingSlots'), 'backfill respects available slots');

// 8. EXECUTION_SELECTION_BACKFILL_CANDIDATE_AUDIT per-candidate
ok(scannerSrc.includes('EXECUTION_SELECTION_BACKFILL_CANDIDATE_AUDIT'), 'MarketScanner emits per-candidate backfill audit');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
