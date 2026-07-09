import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { CandidatePoolSummaryPanel } from '../components/trade-v4/CandidatePoolSummaryPanel';
import { buildCandidatePoolActionabilityCounts } from '../core/scanner/candidatePoolActionability';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => condition ? passed++ : (failed++, console.error(`FAIL: ${label}`));
function eq(actual: unknown, expected: unknown, label: string): void {
  ok(Object.is(actual, expected), `${label} (expected=${String(expected)} actual=${String(actual)})`);
}

const symbols12 = Array.from({ length: 12 }, (_, index) => `BUY${index + 1}USDT`);
const symbols8 = symbols12.slice(0, 8);
const symbols4 = symbols12.slice(8);

const allCooldownBlocked = buildCandidatePoolActionabilityCounts({
  buyCandidateSymbols: symbols12,
  submitEligibleSymbols: [],
  submitAttemptedSymbols: [],
  selectedButNotSubmittedSymbols: symbols12,
  skippedReasonsBySymbol: Object.fromEntries(symbols12.map((symbol) => [symbol, 'BUY_PACING_OR_COOLDOWN_ACTIVE'])),
  selectedButNotSubmittedReasons: ['BUY_PACING_OR_COOLDOWN_ACTIVE'],
  pacingState: {
    lastBuyAt: 1000,
    minBuyIntervalMs: 30_000,
    nextBuyAllowedAt: 31_000,
    msUntilNextBuyAllowed: 30_000,
    buyPacingActive: true,
    buyCooldownActive: true,
    buyPacingReason: 'BUY_PACING_OR_COOLDOWN_ACTIVE',
  },
});
eq(allCooldownBlocked.buyCandidateCount, 12, 'raw BUY candidates are counted as detected BUY candidates');
eq(allCooldownBlocked.actionableBuyCountNow, 0, 'cooldown-blocked candidates are not actionable');
eq(allCooldownBlocked.blockedByPacingCount, 12, 'all BUY candidates blocked by pacing are counted');
eq(allCooldownBlocked.blockedByCooldownCount, 12, 'all BUY candidates blocked by cooldown are counted');
eq(allCooldownBlocked.msUntilNextBuyAllowed, 30_000, 'countdown is sourced from canonical pacing state');
ok(allCooldownBlocked.selectedButNotSubmittedReasons.includes('BUY_PACING_OR_COOLDOWN_ACTIVE'), 'selected-but-not-submitted pacing reason is preserved');

const partialCooldownBlocked = buildCandidatePoolActionabilityCounts({
  buyCandidateSymbols: symbols12,
  submitEligibleSymbols: symbols8,
  submitAttemptedSymbols: [],
  selectedButNotSubmittedSymbols: symbols4,
  skippedReasonsBySymbol: Object.fromEntries(symbols4.map((symbol) => [symbol, 'cooldown_active'])),
  selectedButNotSubmittedReasons: ['cooldown_active'],
  pacingState: {
    msUntilNextBuyAllowed: 42_000,
    buyPacingActive: true,
    buyCooldownActive: true,
  },
});
eq(partialCooldownBlocked.actionableBuyCountNow, 8, 'partial cooldown leaves eight actionable candidates');
eq(partialCooldownBlocked.blockedByPacingCount, 4, 'partial cooldown counts four pacing-blocked candidates');
eq(partialCooldownBlocked.blockedByCooldownCount, 4, 'partial cooldown counts four cooldown-blocked candidates');

const noCooldown = buildCandidatePoolActionabilityCounts({
  buyCandidateSymbols: symbols12,
  submitEligibleSymbols: symbols12,
  submitAttemptedSymbols: [],
  selectedButNotSubmittedSymbols: [],
  skippedReasonsBySymbol: {},
  selectedButNotSubmittedReasons: [],
});
eq(noCooldown.actionableBuyCountNow, 12, 'without pacing, actionable count matches submit-eligible count');
eq(noCooldown.blockedByPacingCount, 0, 'without pacing, blocked-by-pacing count is zero');

const candidates = symbols12.map((symbol) => ({ symbol, status: 'BUY', finalExecutable: true, buyAllowed: true, score: 90 }));
const html = renderToStaticMarkup(
  <CandidatePoolSummaryPanel
    candidates={candidates as any}
    executionPoolSize={12}
    watchPoolSize={0}
    nearMissPoolSize={0}
    paperAutoEnabled
    noBuyDisplay={{
      executionPoolSize: 12,
      watchPoolSize: 0,
      nearMissPoolSize: 0,
      topReasons: ['BUY_PACING_OR_COOLDOWN_ACTIVE'],
      nearestCandidates: [],
      requiredNextActions: [],
      buyReadyCount: 12,
      buyCandidateCount: 12,
      actionableBuyCountNow: 0,
      blockedByPacingCount: 12,
      blockedByCooldownCount: 12,
      selectedButNotSubmittedCount: 12,
      submitAttemptedCount: 0,
      selectedButNotSubmittedReasons: ['BUY_PACING_OR_COOLDOWN_ACTIVE'],
      nextBuyAllowedAt: Date.now() + 42_000,
      msUntilNextBuyAllowed: 42_000,
      buyPacingActive: true,
      buyCooldownActive: true,
      buyPacingReason: 'BUY_PACING_OR_COOLDOWN_ACTIVE',
      countSourceUsed: 'MarketScanner.ExecutionPlanner.AutoBuyExecutionQueue',
    }}
  />,
);
ok(html.includes('BUY candidates'), 'Candidate Pool labels raw BUY count as BUY candidates');
ok(html.includes('Actionable now'), 'Candidate Pool renders actionable count label');
ok(html.includes('Blocked pacing'), 'Candidate Pool renders pacing block count label');
ok(html.includes('BUY_PACING_OR_COOLDOWN_ACTIVE'), 'Candidate Pool renders pacing/cooldown reason visibly');
ok(html.includes('Next buy'), 'Candidate Pool renders next buy timing label');

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
ok(scannerSrc.includes('CANDIDATE_POOL_COUNT_BREAKDOWN_AUDIT'), 'MarketScanner emits candidate pool count breakdown audit');
ok(scannerSrc.includes('BUY_ACTIONABILITY_COUNT_AUDIT'), 'MarketScanner emits buy actionability audit');
ok(scannerSrc.includes('BUY_PACING_COUNTDOWN_AUDIT'), 'MarketScanner emits pacing countdown audit');
ok(scannerSrc.includes('nextBuyAllowedAt'), 'MarketScanner persists next buy allowed timing');

const candidatePoolSrc = readFileSync('src/components/trade-v4/CandidatePoolSummaryPanel.tsx', 'utf8');
ok(candidatePoolSrc.includes('CANDIDATE_POOL_UI_BINDING_AUDIT'), 'Candidate Pool emits UI binding audit');
ok(candidatePoolSrc.includes('countSourceUsed'), 'Candidate Pool binds source-used field from canonical summary');

if (failed > 0) {
  console.error(`candidate-pool-actionability-counts.test: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`candidate-pool-actionability-counts.test: ${passed} passed, ${failed} failed`);
