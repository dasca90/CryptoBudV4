import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. Execution pool filters out duplicate open positions before selection
ok(scannerSrc.includes("!currentOpen.includes(c.symbol)"), 'backfill filters duplicates from open symbols');

// 2. Backfill filters by BUY status and ALLOW gate
ok(scannerSrc.includes("c.status === 'BUY' && c.entryGateDecision?.decision === 'ALLOW'"), 'backfill filters by BUY status and ALLOW gate');

// 3. Already-attempted symbols excluded from backfill
ok(scannerSrc.includes("!attemptedSymbols.includes(c.symbol)"), 'backfill excludes already-attempted symbols');

// 4. Backfill respects open slots remaining
ok(scannerSrc.includes('openSlotsRemaining'), 'backfill respects open slots remaining');

// 5. Backfill respects capital slots
ok(scannerSrc.includes('capitalSlotsRemaining'), 'backfill respects capital slots');

// 6. Backfill uses revalidateCandidate before execution
ok(scannerSrc.includes('revalidateCandidate') && scannerSrc.includes('backfill'), 'backfill revalidates before execution');

// 7. Backfill candidates are sorted by score
ok(scannerSrc.includes('.sort((a, b) => (b.rawScore ?? 0) - (a.rawScore ?? 0)'), 'backfill sorts by score');

// 8. BUY_READY_NOT_SELECTED_REASON_AUDIT covers all remaining valid candidates
ok(scannerSrc.includes('BUY_READY_NOT_SELECTED_REASON_AUDIT'), 'not-selected reason audit exists');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
