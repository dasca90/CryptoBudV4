import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolveTradeSourceLabel } from '../core/notifications/trade-source';
import { resolveEntryRiskParams } from '../core/trading/entry-risk-resolver';
import { resolveTradingTargetOwnership } from '../core/trading/TradingTargetOwnership';
import { logger } from '../utils/logger';

const root = process.cwd();
const plannerSrc = readFileSync(`${root}/src/core/scanner/ExecutionPlanner.ts`, 'utf8');
const engineSrc = readFileSync(`${root}/src/core/trading/TradingEngine.ts`, 'utf8');
const scannerSrc = readFileSync(`${root}/src/core/scanner/MarketScanner.ts`, 'utf8');
const adapterSrc = readFileSync(`${root}/src/lib/air-scanner/tradeV4DataAdapter.ts`, 'utf8');
const journalSrc = readFileSync(`${root}/src/core/persistence/Journal.ts`, 'utf8');
const maintenanceSrc = readFileSync(`${root}/src/core/persistence/localStorageMaintenance.ts`, 'utf8');
const telegramSrc = readFileSync(`${root}/src/core/notifications/telegram-templates.ts`, 'utf8');

function candidate(overrides: Record<string, unknown> = {}): any {
  return {
    candidateId: 'cand_tp1_owner',
    symbol: 'TP1USDT',
    source: 'AutoBots',
    candidateSource: 'AutoBots',
    executionSource: 'auto',
    strategySource: 'autobots',
    ownerName: 'AUTOBOTS',
    selectedStrategy: 'momentum',
    effectiveStrategy: 'momentum',
    riskGroup: 'mid_caps',
    confidence: 0.93,
    price: 10,
    tpRoomOk: true,
    groupTrend: 'bullish',
    dataQuality: 'GOOD',
    traderBrainDecision: {
      selectedPlaybook: 'MOMENTUM_CONFIRMED',
    },
    autoStrategyDecision: {
      strategySource: 'AutoBots',
      confidenceTier: 'A_80_PLUS',
      groupTrend: 'bullish',
    },
    ...overrides,
  };
}

logger.clear();
const unicornOwnership = resolveTradingTargetOwnership(candidate({
  source: 'unicorn_hunter',
  candidateSource: 'Unicorn',
  executionSource: 'unicorn_hunter',
  strategySource: 'unicorn_hunter',
  ownerName: 'UNICORN_HUNTER',
  unicornScore: 94,
  autoStrategyDecision: {
    strategySource: 'UnicornHunter',
    confidenceTier: 'A_80_PLUS',
    groupTrend: 'bullish',
  },
}), {
  strategySource: 'unicorn_hunter',
  manualTp1Pct: 1.5,
  manualTp2Pct: 3,
  stopLossPct: 1.5,
  dynamicTrailingEnabled: true,
  trailPullbackPct: 0.35,
  isScannerAutoTrade: true,
});

assert.equal(unicornOwnership.strategySource, 'unicorn_hunter', 'Unicorn ownership remains Unicorn-owned');
assert.equal(unicornOwnership.tp1Source, 'Unicorn dynamic per coin', 'Unicorn TP1 source is canonical');
assert.equal(unicornOwnership.tp1Min, 5, 'Unicorn TP1 min is 5');
assert.equal(unicornOwnership.tp1Max, 10, 'Unicorn TP1 max is 10');
assert.ok(unicornOwnership.tp1Value >= 5 && unicornOwnership.tp1Value <= 10, 'Unicorn TP1 value is inside 5-10');
assert.notEqual(unicornOwnership.tp1Source, 'AutoBots dynamic per coin', 'Unicorn ownership never uses AutoBots TP1 source');
assert.notEqual(unicornOwnership.tp1Min, 2.5, 'Unicorn ownership never uses AutoBots mid-cap min');
assert.notEqual(unicornOwnership.tp1Max, 4, 'Unicorn ownership never uses AutoBots mid-cap max');
assert.equal(unicornOwnership.tp2Value, 0, 'Unicorn TP2 remains zero');
assert.equal(unicornOwnership.slValue, 1.5, 'Unicorn SL remains user-defined');
assert.equal(unicornOwnership.trailingStartsAt, 'TP1', 'Unicorn dynamic trailing starts at TP1');
assert.equal(unicornOwnership.trailPullbackValue, 0.35, 'Unicorn trail pullback remains user-defined');

const unicornRisk = resolveEntryRiskParams({
  autoBotsOn: true,
  ownership: unicornOwnership,
  userStopLossPct: 1.5,
  userTrailPullbackPct: 0.35,
});
assert.equal(unicornRisk.sourceTp1, 'Unicorn dynamic per coin', 'Entry risk consumes Unicorn TP1 source');
assert.equal(unicornRisk.tp2, 0, 'Entry risk keeps scanner TP2 at zero');
assert.equal(unicornRisk.trailStart, 'TP1', 'Entry risk keeps trailing start at TP1');

const unicornLogs = logger.export();
assert.match(unicornLogs, /UNICORN_TP1_CALC_AUDIT/, 'Unicorn TP1 calculation audit is emitted');
assert.match(unicornLogs, /TP1_OWNER_SOURCE_AUDIT: .*candidateSource=Unicorn/, 'Unicorn TP1 owner/source audit is emitted');
assert.doesNotMatch(unicornLogs, /AUTOBOTS_TP1_SELECTION_AUDIT/, 'Unicorn TP1 calculation does not emit AutoBots TP1 audit');

const autoOwnership = resolveTradingTargetOwnership(candidate(), {
  strategySource: 'autobots',
  manualTp1Pct: 1.5,
  manualTp2Pct: 3,
  stopLossPct: 1.5,
  dynamicTrailingEnabled: false,
  trailPullbackPct: 0.25,
  isScannerAutoTrade: true,
});
assert.equal(autoOwnership.strategySource, 'autobots', 'AutoBots ownership remains AutoBots-owned');
assert.equal(autoOwnership.tp1Source, 'AutoBots dynamic per coin', 'AutoBots TP1 source is unchanged');
assert.equal(autoOwnership.tp1Min, 2.5, 'AutoBots mid-cap TP1 min remains 2.5');
assert.equal(autoOwnership.tp1Max, 4, 'AutoBots mid-cap TP1 max remains 4');
assert.equal(autoOwnership.tp1Value, 4, 'High-confidence AutoBots mid-cap TP1 still uses max range');

const autobotsFirstTrade = {
  buySnapshot: {
    source: 'autobots',
    strategySource: 'autobots',
    candidateSource: 'AutoBots',
    ownerName: 'AUTOBOTS',
    entryConfigSnapshot: {
      riskParams: {
        tp1Pct: autoOwnership.tp1Value,
        tp1Source: autoOwnership.tp1Source,
        sourceTp1: autoOwnership.tp1Source,
        tp1Min: autoOwnership.tp1Min,
        tp1Max: autoOwnership.tp1Max,
      },
    },
  },
} as any;
assert.equal(resolveTradeSourceLabel(autobotsFirstTrade).label, 'AutoBots', 'Unicorn-watched symbol bought by AutoBots stays AutoBots-owned');
assert.equal(autobotsFirstTrade.buySnapshot.entryConfigSnapshot.riskParams.tp1Source, 'AutoBots dynamic per coin', 'AutoBots-first overlap keeps AutoBots TP1 source');
assert.equal(autobotsFirstTrade.buySnapshot.entryConfigSnapshot.riskParams.tp1Min, 2.5, 'AutoBots-first overlap keeps AutoBots TP1 min');
assert.equal(autobotsFirstTrade.buySnapshot.entryConfigSnapshot.riskParams.tp1Max, 4, 'AutoBots-first overlap keeps AutoBots TP1 max');

const unicornTrade = {
  buySnapshot: {
    source: 'unicorn_hunter',
    strategySource: 'unicorn_hunter',
    candidateSource: 'Unicorn',
    ownerName: 'UNICORN_HUNTER',
    entryConfigSnapshot: {
      riskParams: {
        tp1Pct: unicornOwnership.tp1Value,
        tp1Source: unicornOwnership.tp1Source,
        sourceTp1: unicornOwnership.tp1Source,
        tp1Min: unicornOwnership.tp1Min,
        tp1Max: unicornOwnership.tp1Max,
      },
    },
  },
} as any;
assert.equal(resolveTradeSourceLabel(unicornTrade).label, 'Unicorn', 'Journal/Telegram/UI source resolver preserves Unicorn ownership');
assert.equal(unicornTrade.buySnapshot.entryConfigSnapshot.riskParams.tp1Source, 'Unicorn dynamic per coin', 'buySnapshot carries Unicorn TP1 source for all consumers');

assert.ok(plannerSrc.includes('stale_unicorn_tp1_ownership_rebuilt'), 'ExecutionPlanner rebuilds stale Unicorn TP1 ownership');
assert.ok(engineSrc.includes('UNICORN_TP1_OWNERSHIP_STALE_REBUILT'), 'TradingEngine rebuilds stale Unicorn TP1 ownership before submit');
assert.ok(engineSrc.includes('POSITION_TP1_PERSISTENCE_AUDIT'), 'TradingEngine audits persisted TP1 owner/source');
assert.ok(scannerSrc.includes('UNICORN_SYMBOL_TAKEN_BY_AUTOBOTS_AUDIT'), 'AutoBots-first Unicorn overlap remains explicitly audited');
assert.ok(maintenanceSrc.includes("isUnicornOwned ? 'Unicorn dynamic per coin' : 'AutoBots dynamic per coin'"), 'Persistence repair keeps Unicorn TP1 source when rebuilding minimal risk snapshots');
assert.ok(maintenanceSrc.includes('isUnicornOwned ? 5 : null') && maintenanceSrc.includes('isUnicornOwned ? 10 : null'), 'Persistence repair keeps Unicorn TP1 min/max when rebuilding minimal risk snapshots');
assert.ok(adapterSrc.includes('riskTp1Source') && adapterSrc.includes('tp1Min') && adapterSrc.includes('tp1Max'), 'Open/Closed UI adapter reads canonical TP1 source/range from risk snapshot');
assert.ok(journalSrc.includes('entryRiskSnapshot'), 'Journal/export includes canonical entry risk snapshot');
assert.ok(telegramSrc.includes('tp1Source') && telegramSrc.includes('owner=${sanitizeTelegramText'), 'Telegram reads canonical owner and TP1 source from buy snapshot risk data');

console.log('unicorn-tp1-ownership tests passed');
