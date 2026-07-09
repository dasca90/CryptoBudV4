import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveTradeSourceLabel } from '../core/notifications/trade-source';
import { resolveCandidateExecutionOwnership } from '../core/trading/TradingTargetOwnership';

const root = process.cwd();
const engineSrc = readFileSync(`${root}/src/core/trading/TradingEngine.ts`, 'utf8');
const plannerSrc = readFileSync(`${root}/src/core/scanner/ExecutionPlanner.ts`, 'utf8');
const scannerSrc = readFileSync(`${root}/src/core/scanner/MarketScanner.ts`, 'utf8');
const positionManagerSrc = readFileSync(`${root}/src/core/positions/PositionManager.ts`, 'utf8');

const baseCandidate = {
  candidateId: 'cand-owner-1',
  symbol: 'OWNUSDT',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  mode: 'AUTO',
  riskGroup: 'large_cap',
  selectedStrategy: 'balanced',
  selectedPlaybook: 'BALANCED_OK',
  confidence: 0.91,
  status: 'BUY',
  traderBrainDecision: { selectedPlaybook: 'BALANCED_OK' },
  entryGateDecision: { decision: 'ALLOW' },
  mainReason: 'BALANCED_OK',
  requiredNextActions: [],
  blockReasons: [],
  warnings: [],
  price: 10,
  priceAgeMs: 100,
  spreadPct: 0.05,
  volumeRel: 1.5,
  tpRoomOk: true,
  reboundConfirmed: true,
  momentumConfirmed: true,
  dipPercent: -1,
  reboundPercent: 1,
  m5Change: 1,
  m15Change: 1,
  h1Change: 1,
  change24h: 4,
  mlBadEntryRisk: false,
  mlWinProbability: 0.7,
} as any;

const autoOwnership = resolveCandidateExecutionOwnership({
  candidate: { ...baseCandidate, source: 'AutoBots', candidateSource: 'AutoBots', ownerName: 'AUTOBOTS' },
  selectedBy: 'AutoBots',
  executedBy: 'AutoBots',
  finalExecutionStrategy: 'balanced',
  entryRule: 'BALANCED_OK',
});
assert.equal(autoOwnership.candidateSource, 'AutoBots', 'AutoBots candidate remains AutoBots-owned');
assert.equal(autoOwnership.ownerName, 'AUTOBOTS', 'AutoBots ownerName is preserved');
assert.equal(autoOwnership.scannerModule, 'AutoBots', 'AutoBots scanner module is canonical');

const unicornOwnership = resolveCandidateExecutionOwnership({
  candidate: { ...baseCandidate, source: 'unicorn_hunter', candidateSource: 'unicorn_hunter', ownerName: 'UNICORN_HUNTER' },
  selectedBy: 'Unicorn Hunter',
  executedBy: 'Unicorn Hunter',
  finalExecutionStrategy: 'momentum',
  entryRule: 'UNICORN_ENTRY_READY',
});
assert.equal(unicornOwnership.candidateSource, 'Unicorn', 'Unicorn candidate remains Unicorn-owned');
assert.equal(unicornOwnership.ownerName, 'UNICORN_HUNTER', 'Unicorn ownerName is not overwritten');
assert.equal(unicornOwnership.strategySource, 'unicorn_hunter', 'Unicorn strategy source is canonical');
assert.equal(unicornOwnership.executionSource, 'unicorn_hunter', 'Unicorn execution source is canonical');
assert.equal(unicornOwnership.invariantOk, true, 'Unicorn ownership invariant passes');

const unicornLabel = resolveTradeSourceLabel({
  buySnapshot: {
    source: 'unicorn_hunter',
    strategySource: 'unicorn_hunter',
    candidateSource: 'Unicorn',
    ownerName: 'UNICORN_HUNTER',
  },
} as any);
assert.equal(unicornLabel.label, 'Unicorn', 'Journal/Telegram/UI source resolver treats canonical Unicorn candidateSource as Unicorn');

assert.ok(plannerSrc.includes('CANDIDATE_OWNERSHIP_AUDIT'), 'ExecutionPlanner logs candidate ownership');
assert.ok(plannerSrc.includes('CANDIDATE_SOURCE_HANDOFF_AUDIT'), 'ExecutionPlanner logs candidate source handoff');
assert.ok(plannerSrc.includes('EXECUTION_OWNER_DECISION_AUDIT'), 'ExecutionPlanner logs execution owner decisions');
assert.ok(plannerSrc.includes('candidateSource: ownershipForPlan.candidateSource'), 'Planner persists canonical candidateSource in entry config snapshot');
assert.ok(plannerSrc.includes('selectedBy: ownershipForPlan.selectedBy'), 'Planner persists selectedBy in entry config snapshot');
assert.ok(plannerSrc.includes('executedBy: ownershipForPlan.executedBy'), 'Planner persists executedBy in entry config snapshot');

assert.ok(engineSrc.includes('resolveCandidateExecutionOwnership'), 'TradingEngine consumes canonical ownership resolver');
assert.ok(engineSrc.includes('ownerName: ownershipForEntry.ownerName'), 'TradingEngine fallback entry snapshot does not hardcode AutoBots owner');
assert.ok(engineSrc.includes('candidateSource: ownershipForEntry.candidateSource'), 'TradingEngine persists canonical buySnapshot candidateSource');
assert.ok(engineSrc.includes('scannerModule: ownershipForEntry.scannerModule'), 'TradingEngine persists scannerModule');
assert.ok(engineSrc.includes('selectedBy: ownershipForEntry.selectedBy'), 'TradingEngine persists selectedBy');
assert.ok(engineSrc.includes('executedBy: ownershipForEntry.executedBy'), 'TradingEngine persists executedBy');
assert.ok(engineSrc.includes('POSITION_OWNER_PERSISTENCE_AUDIT'), 'TradingEngine audits owner persistence before/after PositionManager');
assert.ok(!engineSrc.includes("ownerName: 'AUTOBOTS',\r\n          source: scannerExecutionSource"), 'Fallback entry config no longer stamps all scanner trades as AutoBots');

assert.ok(positionManagerSrc.includes('POSITION_OWNER_PERSISTENCE_AUDIT'), 'PositionManager emits canonical owner persistence audit');
assert.ok(scannerSrc.includes('UNICORN_SYMBOL_TAKEN_BY_AUTOBOTS_AUDIT'), 'AutoBots taking a Unicorn-watched symbol is explicitly audited');
assert.ok(scannerSrc.includes('reason=AUTOBOTS_EXECUTED_FIRST'), 'Overlap audit records first-valid-executor behavior');
assert.ok(scannerSrc.includes("lastReason: 'UNICORN_BLOCK_DUPLICATE_POSITION'"), 'Unicorn state records duplicate blocker when AutoBots buys first');
assert.ok(scannerSrc.includes("autobotsTookUnicornWatched[0]?.symbol"), 'Unicorn status surfaces the symbol taken by AutoBots');

console.log('candidate ownership boundary tests passed');
