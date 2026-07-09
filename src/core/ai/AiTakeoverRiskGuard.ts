import type { AiDecisionInput, AiDecisionOutput, AiTakeoverConfig } from './AiTakeoverTypes';

export interface RiskGuardResult {
  allowed: boolean;
  reason: string;
  blockedBy: string[];
  adjustedOutput: AiDecisionOutput;
}

export class AiTakeoverRiskGuard {
  evaluate(output: AiDecisionOutput, config: AiTakeoverConfig, input: AiDecisionInput): RiskGuardResult {
    const blockedBy: string[] = [];
    const adjustedOutput: AiDecisionOutput = {
      ...output,
      tpPlan: { ...output.tpPlan, tp2Pct: 0 },
    };

    if (config.mode !== 'ON') blockedBy.push('AI_TAKEOVER_OFF');
    if (output.decision !== 'BUY' || output.executionIntent.wantsBuy !== true) blockedBy.push('NOT_BUY_INTENT');
    if (!input.retrospective) blockedBy.push('RETROSPECTIVE_ANALYSIS_MISSING');
    if (input.priceFresh === false) blockedBy.push('price_stale');
    if (input.bookFresh === false) blockedBy.push('book_stale');
    if (input.spreadPct > 0.35) blockedBy.push('spread_too_high');
    if (input.duplicateOpenPosition === true) blockedBy.push('duplicate_position');
    if (input.maxOpenPositionsOk === false) blockedBy.push('max_open_positions');
    if (input.maxCapitalPerTradeOk === false) blockedBy.push('max_capital_per_trade');
    if (input.maxDailyLossOk === false) blockedBy.push('max_daily_loss');
    if (input.maxTradesPerDayOk === false) blockedBy.push('max_trades_per_day');
    if (input.cooldownOk === false) blockedBy.push('cooldown');
    if (input.minOrderNotionalOk === false) blockedBy.push('min_order_notional');
    if (input.slDefined === false || adjustedOutput.riskPlan.slPct <= 0) blockedBy.push('sl_missing');
    if (adjustedOutput.tpPlan.tp1Pct <= 0) blockedBy.push('tp1_missing');
    if (input.tpRoomOk === false) blockedBy.push('tp_room_too_small');
    if (input.retrospective?.cleanUpsidePct !== undefined && input.retrospective.cleanUpsidePct < config.minCleanUpsidePct) {
      blockedBy.push('CLEAN_UPSIDE_TOO_SMALL');
    }

    if (blockedBy.length > 0) {
      return {
        allowed: false,
        reason: `CryptoBud blocked execution because: ${blockedBy[0]}`,
        blockedBy,
        adjustedOutput,
      };
    }

    return {
      allowed: true,
      reason: 'All AI Takeover hard guards passed.',
      blockedBy: [],
      adjustedOutput,
    };
  }
}
