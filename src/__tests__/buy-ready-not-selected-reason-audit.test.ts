import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. BUY_READY_NOT_SELECTED_REASON_AUDIT exists
ok(scannerSrc.includes('BUY_READY_NOT_SELECTED_REASON_AUDIT'), 'not-selected reason audit exists');

// 2. Per-symbol diagnostic fields
ok(scannerSrc.includes('finalExecutable=${String(setup.finalExecutable)}'), 'not-selected audit shows finalExecutable');
ok(scannerSrc.includes('buyAllowed=${String(setup.buyAllowed)}'), 'not-selected audit shows buyAllowed');
ok(scannerSrc.includes('setupResult=${setup.setupResult}'), 'not-selected audit shows setupResult');
ok(scannerSrc.includes('openPositionDuplicate=${String(isDuplicate)}'), 'not-selected audit shows openPositionDuplicate');
ok(scannerSrc.includes('skippedBySelectionLimit=${String(false)}'), 'not-selected audit confirms selection limit removed');
ok(scannerSrc.includes('skippedBecauseNoBackfill=${String(!backfillCandidateSymbols'), 'not-selected audit marks no backfill');
ok(scannerSrc.includes('selectedForExecution=false'), 'not-selected audit marks not selected');
ok(scannerSrc.includes('finalNoBuyReason=${reason}'), 'not-selected audit shows final reason');

// 3. Reason includes duplicate_position
ok(scannerSrc.includes("'duplicate_position'"), 'not-selected reason includes duplicate_position');

// 4. Reason includes cooldown
ok(scannerSrc.includes("'cooldown'"), 'not-selected reason includes cooldown');

// 5. Reason includes max_positions_or_capital_reached (real safety limit, not artificial selection cap)
ok(scannerSrc.includes("'max_positions_or_capital_reached'"), 'not-selected reason uses real safety limit label');

// 6. Covers all BUY_READY candidates not attempted
ok(scannerSrc.includes("!attemptedSymbols.includes(c.symbol)"), 'not-selected covers unattempted BUY_READY candidates');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
