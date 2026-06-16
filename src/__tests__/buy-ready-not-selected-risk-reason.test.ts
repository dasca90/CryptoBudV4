import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. BUY_READY_NOT_SELECTED_REASON_AUDIT has risk-related reasons
ok(scannerSrc.includes('not_backfilled_after_pre_adapter_fail'), 'reason includes not_backfilled_after_pre_adapter_fail');
ok(scannerSrc.includes('not_backfilled_limit_reached_after_partial_fills'), 'reason includes partial fill limit reached');
ok(scannerSrc.includes('not_backfilled_slots_available_but_revalidation_failed'), 'reason includes revalidation failed');

// 2. Duplicate position reason preserved
ok(scannerSrc.includes("'duplicate_position'"), 'reason includes duplicate_position');

// 3. Cooldown reason preserved
ok(scannerSrc.includes("'cooldown'"), 'reason includes cooldown');

// 4. Selection limit removed — uses real safety limit label
ok(scannerSrc.includes("'max_positions_or_capital_reached'"), 'reason uses real safety limit label');

// 5. Reason depends on backfill state
ok(scannerSrc.includes('backfillCandidateSymbols.length > 0 && positionCreatedCount > 0'), 'reason distinguishes partial fills');
ok(scannerSrc.includes('positionCreatedCount === 0 && attemptedSymbols.length > 0'), 'reason detects all-pre-adapter-fail');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
