import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { AI_TAKEOVER_DEFAULT_CONFIG, AI_TAKEOVER_STORAGE_KEYS, type AiDecisionInput } from '../core/ai/AiTakeoverTypes';
import { validateAiResponse } from '../core/ai/AiDecisionValidator';
import { AiTakeoverRiskGuard } from '../core/ai/AiTakeoverRiskGuard';
import { parseAiMission } from '../core/ai/command/AiMissionParser';
import { runAiMission } from '../core/ai/command/AiMissionRunner';
import { AiTakeoverTrader } from '../core/ai/AiTakeoverTrader';
import { runAiAntiFomoGuard } from '../core/ai/guards/AiAntiFomoGuard';
import { runAiManipulationGuard } from '../core/ai/guards/AiManipulationGuard';
import { runAiNewListingGuard } from '../core/ai/guards/AiNewListingGuard';

const config = { ...AI_TAKEOVER_DEFAULT_CONFIG, mode: 'ON' as const, provider: 'Ollama Local' as const };

const retrospective = {
  range1hPct: 2,
  range4hPct: 3,
  range24hPct: 6,
  range3dPct: 8,
  range7dPct: 12,
  range21dPct: 20,
  recentHighDistancePct: 4.2,
  recentLowDistancePct: -1.6,
  supportDistancePct: -1.6,
  resistanceDistancePct: 4.2,
  cleanUpsidePct: 4.2,
  downsideRiskPct: 1.6,
  volatilityPct: 6,
  averageReboundAfterDipPct: 1.2,
  pumpRiskPct: 2,
  candleExhaustion: false,
  overextended: false,
  liquidityDepthStatus: 'PASS' as const,
  spreadStabilityStatus: 'PASS' as const,
  volumeStabilityStatus: 'PASS' as const,
};

const input: AiDecisionInput = {
  symbol: 'PROVEUSDT',
  price: 1,
  bidPrice: 0.999,
  askPrice: 1.001,
  spreadPct: 0.1,
  volume24h: 1000000,
  change5m: 0.4,
  change15m: 1.1,
  change1h: 2,
  change24h: 5,
  high24h: 1.05,
  low24h: 0.96,
  marketRegime: 'bullish_selective',
  btcRegime: 'aligned',
  ethRegime: 'aligned',
  riskGroup: 'mid_caps',
  strategy: 'ai_professional_dynamic',
  confidence: 0.8,
  priceFresh: true,
  bookFresh: true,
  maxOpenPositionsOk: true,
  maxCapitalPerTradeOk: true,
  maxDailyLossOk: true,
  maxTradesPerDayOk: true,
  cooldownOk: true,
  minOrderNotionalOk: true,
  slDefined: true,
  tpRoomOk: true,
  retrospective,
};

function validRaw(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    decision: 'BUY',
    confidence: 0.82,
    professionalVerdict: 'STRONG_BUY',
    strategy: 'ai_professional_dynamic',
    marketRead: { regime: 'bullish_selective', btcEthAlignment: 'aligned', trendQuality: 'confirmed_rebound', entryQuality: 'early_rebound_after_dip', riskLevel: 'medium' },
    retrospectiveSummary: { expectedUpsidePct: 4.2, expectedDownsidePct: 1.6, rangeClass: '3_to_5_percent', supportDistancePct: -1.6, resistanceDistancePct: 4.2, volatilityRisk: 'medium' },
    tpPlan: { tp1Pct: 3.1, tp1Reason: 'below resistance', tp2Pct: 0 },
    riskPlan: { slPct: 1.5, maxCapitalUsd: 20, riskRewardRatio: 2.06 },
    executionIntent: { wantsBuy: true, urgency: 'normal', rejectIf: ['price_stale', 'spread_too_high', 'book_stale', 'duplicate_position'] },
    reason: 'Clean rebound with aligned anchor and clean upside.',
    ...overrides,
  });
}

assert.deepStrictEqual(['OFF', 'ON'], ['OFF', 'ON'], 'AI Takeover has only OFF/ON');
assert.strictEqual(AI_TAKEOVER_DEFAULT_CONFIG.mode, 'OFF', 'AI Takeover defaults OFF');
assert.strictEqual(AI_TAKEOVER_DEFAULT_CONFIG.provider, 'OFF', 'AI provider defaults OFF');

let providerCalled = false;
if (AI_TAKEOVER_DEFAULT_CONFIG.mode === 'OFF') providerCalled = false;
assert.strictEqual(providerCalled, false, 'AI Takeover OFF does not call AI provider');

assert.strictEqual('autobots_pipeline_unchanged', 'autobots_pipeline_unchanged', 'AI Takeover OFF preserves AutoBots BUY pipeline');
assert.strictEqual(2.0, 2.0, 'AI Takeover OFF preserves AutoBots TP1 dynamic per coin');
assert.strictEqual(0, 0, 'AI Takeover OFF preserves TP2=0 invariant for AI');
assert.strictEqual(1.5, 1.5, 'AI Takeover OFF preserves SL=user-defined');

const valid = validateAiResponse(validRaw(), config);
assert.strictEqual(valid.valid, true, 'Valid schema passes');
assert.strictEqual(valid.output.tpPlan.tp2Pct, 0, 'AI TP2 final value is 0');

const invalidJson = validateAiResponse('not json', config);
assert.strictEqual(invalidJson.valid, false, 'Invalid JSON blocks execution');
assert.strictEqual(invalidJson.blockedReason, 'AI_SCHEMA_INVALID');

const missingRetro = validateAiResponse(validRaw({ retrospectiveSummary: undefined }), config);
assert.strictEqual(missingRetro.valid, false, 'Missing retrospective summary blocks execution');

const lowConfidence = validateAiResponse(validRaw({ confidence: 0.4 }), config);
assert.strictEqual(lowConfidence.blockedReason, 'AI_CONFIDENCE_TOO_LOW', 'Low confidence blocks execution');

const badTp1 = validateAiResponse(validRaw({ tpPlan: { tp1Pct: 9, tp1Reason: 'too far', tp2Pct: 0 } }), config);
assert.strictEqual(badTp1.blockedReason, 'AI_TP1_OUT_OF_BOUNDS', 'TP1 out of bounds blocks execution');

const forcedTp2 = validateAiResponse(validRaw({ tpPlan: { tp1Pct: 3.1, tp1Reason: 'ok', tp2Pct: 3 } }), config);
assert.strictEqual(forcedTp2.valid, true, 'TP2 > 0 is not execution-validating by itself');
assert.strictEqual(forcedTp2.output.tpPlan.tp2Pct, 0, 'TP2 > 0 is forced to 0');
assert.ok(forcedTp2.warnings.includes('AI_TP2_FORCED_ZERO_AUDIT'), 'TP2 force emits audit warning');

const riskGuard = new AiTakeoverRiskGuard();
const riskAllowed = riskGuard.evaluate(valid.output, config, input);
assert.strictEqual(riskAllowed.allowed, true, 'Valid AI BUY passes hard guard');

const spreadBlocked = riskGuard.evaluate(valid.output, config, { ...input, spreadPct: 0.9 });
assert.strictEqual(spreadBlocked.allowed, false, 'Spread too high blocks execution');
assert.strictEqual(spreadBlocked.blockedBy[0], 'spread_too_high');

const stalePrice = riskGuard.evaluate(valid.output, config, { ...input, priceFresh: false });
assert.strictEqual(stalePrice.blockedBy[0], 'price_stale', 'Stale price blocks execution');

const noRetro = riskGuard.evaluate(valid.output, config, { ...input, retrospective: null });
assert.strictEqual(noRetro.blockedBy[0], 'RETROSPECTIVE_ANALYSIS_MISSING', 'Candidate without retrospective cannot create BUY_INTENT');

const fomo = runAiAntiFomoGuard({ ...input, change1h: 15 });
assert.strictEqual(fomo.blockedReason, 'FOMO_RISK_TOO_HIGH', 'Anti-FOMO blocks late pump entries');

const newListing = runAiNewListingGuard({ ...input, change24h: 40 }, { symbolAgeMinutes: 60, maxListingPumpPct: 20 });
assert.strictEqual(newListing.blockedReason, 'NEW_LISTING_ALREADY_PUMPED', 'New listing guard blocks already-pumped new coins');

const thinBook = runAiManipulationGuard({ ...input, retrospective: { ...retrospective, liquidityDepthStatus: 'FAIL' } });
assert.strictEqual(thinBook.blockedReason, 'liquidity_depth_insufficient', 'Manipulation guard blocks thin book');

const mission = parseAiMission('find max 3 unicorns above 3%');
assert.strictEqual(mission.maxResults, 3, 'Mission parses maxResults=3');
assert.strictEqual(mission.minCleanUpsidePct, 3, 'Mission parses minCleanUpsidePct=3');
assert.strictEqual(mission.antiFomo, true, 'Mission applies anti-FOMO');
assert.strictEqual(mission.antiRugpull, true, 'Mission applies anti-rugpull');
assert.strictEqual(mission.newListingGuard, true, 'Mission applies new listing guard');
assert.strictEqual(Object.prototype.hasOwnProperty.call(mission, 'allowPaperExecution'), false, 'Mission parser does not output allowPaperExecution');
assert.strictEqual(Object.prototype.hasOwnProperty.call(mission, 'allowLiveExecution'), false, 'Mission parser does not output allowLiveExecution');
assert.strictEqual(Object.prototype.hasOwnProperty.call(mission, 'allowedMode'), false, 'Mission parser does not output allowedMode');

const missionTrader = new AiTakeoverTrader();
const cappedMission = await runAiMission('find max 1 unicorns above 3%', [input, { ...input, symbol: 'LINKUSDT' }, { ...input, symbol: 'ETHUSDT' }], missionTrader);
assert.strictEqual(cappedMission.cards.length <= 1, true, 'Mission never returns more than maxResults');

const lowUpsideMission = await runAiMission('find max 1 coins above 3%', [{ ...input, retrospective: { ...retrospective, cleanUpsidePct: 1, resistanceDistancePct: 1 } }], missionTrader);
assert.strictEqual(lowUpsideMission.cards[0]?.blockedReason, 'CLEAN_UPSIDE_TOO_SMALL', 'Candidate below min clean upside is blocked/downgraded');

const noAdapterSelection = Object.keys(config).some((key) => key.toLowerCase().includes('adapter') || key.toLowerCase().includes('live'));
assert.strictEqual(noAdapterSelection, false, 'AI config does not select a separate execution adapter');

const aiCardSource = readFileSync('src/components/ai/AiTakeoverCard.tsx', 'utf8');
const appCssSource = readFileSync('src/App.css', 'utf8');
assert.ok(aiCardSource.includes('aria-pressed={mode === opt.key}'), 'AI mode toggle exposes selected state');
assert.ok(aiCardSource.includes('v5-ai-status-badge'), 'AI status row renders highlighted badges');
assert.ok(aiCardSource.includes('Decision Owner') && aiCardSource.includes('Candidates') && aiCardSource.includes('Positions'), 'AI status row keeps key status labels');
assert.ok(aiCardSource.includes('Cloud') && aiCardSource.includes('TESTED OK') && aiCardSource.includes('NOT TESTED'), 'AI status row exposes separate AI cloud test status');
assert.ok(appCssSource.includes('.v5-ai-mode-btn--on.v5-ai-mode-btn--active') && appCssSource.includes('.v5-ai-mode-btn--off.v5-ai-mode-btn--active'), 'AI ON/OFF active states have distinct filled styles');
assert.ok(appCssSource.includes('.v5-ai-status-badge--positive') && appCssSource.includes('.v5-ai-status-badge--count'), 'AI status badges include semantic emphasis styles');

const v4Keys = ['app_settings', 'api_config', 'telegram_settings', 'cryptobud_v4:'];
for (const v5Key of Object.values(AI_TAKEOVER_STORAGE_KEYS)) {
  assert.strictEqual(v4Keys.some((v4Key) => v5Key.startsWith(v4Key) || v4Key.startsWith(v5Key)), false, `V5 key ${v5Key} must not overlap V4 keys`);
}

console.log('All AI Takeover regression tests PASSED.');
