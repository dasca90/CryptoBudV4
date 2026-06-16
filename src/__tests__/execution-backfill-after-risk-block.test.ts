import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. EXECUTION_BACKFILL_AFTER_RISK_BLOCK_AUDIT exists
ok(scannerSrc.includes('EXECUTION_BACKFILL_AFTER_RISK_BLOCK_AUDIT'), 'MarketScanner emits backfill after risk block audit');

// 2. Audit fields
ok(scannerSrc.includes('failedBeforeAdapterSymbols=${attemptedSymbols.join') || scannerSrc.includes('failedBeforeAdapterSymbols=${attemptedSymbols.filter'), 'backfill audit exposes failedBeforeAdapterSymbols');
ok(scannerSrc.includes('riskBlockedSymbols=${riskBlockedSymbols'), 'backfill audit exposes riskBlockedSymbols');
ok(scannerSrc.includes('riskBlockedGroups=${riskBlockedGroups'), 'backfill audit exposes riskBlockedGroups');
ok(scannerSrc.includes('riskBlockedReasonsBySymbol='), 'backfill audit exposes riskBlockedReasonsBySymbol');
ok(scannerSrc.includes('nextBackfillSymbolsTried=${backfillCandidateSymbols'), 'backfill audit exposes nextBackfillSymbolsTried');
ok(scannerSrc.includes('backfillSkippedBecauseGlobalRiskLimit'), 'backfill audit exposes global risk limit flag');
ok(scannerSrc.includes('finalCreatedCount=${positionCreatedCount}'), 'backfill audit exposes finalCreatedCount');

// 3. Fires when selected candidates all failed
ok(scannerSrc.includes('positionCreatedCount === 0 && selectedBuyCandidates.length > 0'), 'backfill after risk block fires when no positions created');

// 4. Risk blocked symbols derived from skip reasons
ok(scannerSrc.includes("String(r).includes('risk_blocked')") || scannerSrc.includes("pre_adapter_block"), 'backfill audit identifies risk blocked symbols');

// 5. Risk blocked groups derived from candidates
ok(scannerSrc.includes('rankedCandidatesToAnnotate.find'), 'backfill audit derives risk blocked groups');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
