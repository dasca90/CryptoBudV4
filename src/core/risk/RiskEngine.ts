import type { RiskInput, RiskDecision, RiskBlockReason, RiskConfig, OrderFilterValidation } from '../types';
import { validateOrderAgainstFilters } from '../market-data/symbol-filters';
import { logger } from '../../utils/logger';
import { DEFAULT_RISK_CONFIG } from './risk-config';

export class RiskEngine {
  private config: RiskConfig;

  constructor(config?: Partial<RiskConfig>) {
    this.config = { ...DEFAULT_RISK_CONFIG, ...config };
  }

  getConfig(): RiskConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  evaluateRisk(input: RiskInput): RiskDecision {
    const blockReasons: RiskBlockReason[] = [];
    const warnings: string[] = [];

    const maxAllowedQty = this.computeMaxAllowedQuantity(input);

    let maxAllowedExposureUsd = 0;
    let remainingDailyLossUsd = 0;
    let remainingDailyTrades = 0;

    // 1. Account balance check
    if (input.accountBalance < 100) {
      blockReasons.push('BLOCK_ACCOUNT_BALANCE_TOO_LOW');
      warnings.push(`Account balance $${input.accountBalance.toFixed(2)} below $100 minimum`);
    }

    // 2. Max daily loss check
    const dailyLossLimit = Math.min(
      this.config.maxDailyLossUsd,
      input.accountBalance * (this.config.maxDailyLossPercent / 100),
    );
    if (input.dailyPnlUsd < 0 && Math.abs(input.dailyPnlUsd) >= dailyLossLimit) {
      blockReasons.push('BLOCK_MAX_DAILY_LOSS');
      warnings.push(`Daily loss $${Math.abs(input.dailyPnlUsd).toFixed(2)} exceeds limit $${dailyLossLimit.toFixed(2)}`);
    }
    remainingDailyLossUsd = Math.max(0, dailyLossLimit - Math.abs(Math.min(input.dailyPnlUsd, 0)));

    // 3. Max drawdown check
    if (input.maxDrawdownPercent >= this.config.maxDrawdownPercent) {
      blockReasons.push('BLOCK_MAX_DRAWDOWN');
      warnings.push(`Drawdown ${input.maxDrawdownPercent.toFixed(1)}% exceeds ${this.config.maxDrawdownPercent}% limit`);
    }

    // 4. Max position size (percent of account)
    const positionSizePct = (input.estimatedValue / input.accountBalance) * 100;
    const maxSizeByPct = input.accountBalance * (this.config.maxPositionSizePercent / 100);
    const effectiveMaxSize = Math.min(maxSizeByPct, this.config.maxPositionSizeUsd);
    if (input.estimatedValue > effectiveMaxSize) {
      blockReasons.push('BLOCK_MAX_POSITION_SIZE');
      warnings.push(`Position $${input.estimatedValue.toFixed(2)} exceeds max $${effectiveMaxSize.toFixed(2)}`);
    }

    // 5. Max capital at risk per trade
    if (input.estimatedValue > this.config.maxCapitalAtRiskPerTrade) {
      blockReasons.push('BLOCK_MAX_CAPITAL_AT_RISK');
      warnings.push(`Trade value $${input.estimatedValue.toFixed(2)} exceeds max capital at risk $${this.config.maxCapitalAtRiskPerTrade}`);
    }

    // 6. Max capital at risk total (sum of all open positions + this trade)
    const totalExposureAfterTrade = input.estimatedValue + (input.totalOpenPositions > 0 ? this.estimateTotalExposure(input) : 0);
    if (totalExposureAfterTrade > this.config.maxCapitalAtRiskTotal) {
      blockReasons.push('BLOCK_MAX_CAPITAL_AT_RISK');
      warnings.push(`Total exposure $${totalExposureAfterTrade.toFixed(2)} exceeds max $${this.config.maxCapitalAtRiskTotal}`);
    }

    // 7. Max daily trades
    if (input.dailyTradeCount >= this.config.maxDailyTrades) {
      blockReasons.push('BLOCK_MAX_DAILY_TRADES');
      warnings.push(`Daily trades ${input.dailyTradeCount} exceeds max ${this.config.maxDailyTrades}`);
    }
    remainingDailyTrades = Math.max(0, this.config.maxDailyTrades - input.dailyTradeCount);

    // 8. Max consecutive losses
    if (input.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      blockReasons.push('BLOCK_CONSECUTIVE_LOSSES');
      warnings.push(`${input.consecutiveLosses} consecutive losses exceeds max ${this.config.maxConsecutiveLosses}`);
    }

    // 9. Win rate too low
    if (input.winRate < this.config.minWinRate && input.dailyTradeCount >= 5) {
      blockReasons.push('BLOCK_WIN_RATE_TOO_LOW');
      warnings.push(`Win rate ${(input.winRate * 100).toFixed(0)}% below minimum ${(this.config.minWinRate * 100).toFixed(0)}%`);
    }

    // 10. Min confidence override
    const minConfidence = this.config.minConfidenceOverride[input.mode] ?? 0.4;
    if (input.mlConfidence < minConfidence) {
      blockReasons.push('BLOCK_MIN_CONFIDENCE');
      warnings.push(`Confidence ${(input.mlConfidence * 100).toFixed(0)}% below ${(minConfidence * 100).toFixed(0)}% floor for ${input.mode}`);
    }

    // 11. Max leverage per mode
    const maxLeverage = this.config.maxLeveragePerMode[input.mode] ?? 1;
    if (maxLeverage < 1) {
      blockReasons.push('BLOCK_MAX_LEVERAGE');
      warnings.push(`Leverage ${maxLeverage}x not allowed for ${input.mode}`);
    }

    // 12. Risk group checks
    const groupExposureAfterTrade: Record<string, number> = {};
    if (input.riskGroup) {
      const groupConfig = input.groupExposures.find(g => g.riskGroup === input.riskGroup);
      const maxGroupPos = this.config.maxPositionsPerRiskGroup[input.riskGroup] ?? 3;
      const maxGroupExp = this.config.maxExposurePerRiskGroup[input.riskGroup] ?? 5000;

      const currentGroupPos = groupConfig?.currentPositions ?? 0;
      const currentGroupExp = groupConfig?.currentExposureUsd ?? 0;

      if (currentGroupPos >= maxGroupPos) {
        blockReasons.push('BLOCK_MAX_GROUP_POSITIONS');
        warnings.push(`Group ${input.riskGroup} already at max ${maxGroupPos} positions`);
      }

      const exposureAfter = currentGroupExp + input.estimatedValue;
      if (exposureAfter > maxGroupExp) {
        blockReasons.push('BLOCK_MAX_GROUP_EXPOSURE');
        warnings.push(`Group ${input.riskGroup} exposure $${exposureAfter.toFixed(2)} exceeds $${maxGroupExp}`);
      }

      groupExposureAfterTrade[input.riskGroup] = exposureAfter;
    }

    // 14. Duplicate position check
    if (input.positionSymbols?.includes(input.symbol)) {
      blockReasons.push('RISK_DUPLICATE_POSITION');
      warnings.push(`${input.symbol} position already open`);
    }

    // 15. Position already closing
    if (input.positionClosing?.includes(input.symbol)) {
      blockReasons.push('RISK_POSITION_ALREADY_CLOSING');
      warnings.push(`${input.symbol} position is already closing`);
    }

    // 16. Max positions reached
    const maxPos = (input.config as any).maxOpenPositions ?? 20;
    if (input.currentPositions >= maxPos) {
      blockReasons.push('RISK_MAX_POSITIONS_REACHED');
      warnings.push(`Open positions ${input.currentPositions} >= max ${maxPos}`);
    }

    // 17. ML bad entry risk check
    if (input.mlBadEntryRisk !== undefined && input.mlBadEntryRisk >= 0.80) {
      blockReasons.push('BLOCK_MIN_CONFIDENCE');
      warnings.push(`ML badEntryRisk ${(input.mlBadEntryRisk * 100).toFixed(0)}% >= 80%, blocked`);
    } else if (input.mlBadEntryRisk !== undefined && input.mlBadEntryRisk >= 0.65) {
      warnings.push(`ML badEntryRisk ${(input.mlBadEntryRisk * 100).toFixed(0)}% >= 65%, elevated risk`);
    }

    // 13. Symbol filter validation (Phase 12)
    let filterValidation: OrderFilterValidation | undefined;
    if (input.filters) {
      filterValidation = validateOrderAgainstFilters(
        input.symbol, input.side, input.price, input.quantity, input.filters,
      );
      for (const r of filterValidation.blockReasons) {
        if (r === 'FILTER_SYMBOL_NOT_FOUND') blockReasons.push('FILTER_SYMBOL_NOT_FOUND');
        if (r === 'FILTER_SYMBOL_NOT_TRADABLE') blockReasons.push('FILTER_SYMBOL_NOT_TRADABLE');
        if (r === 'FILTER_MIN_NOTIONAL') blockReasons.push('FILTER_MIN_NOTIONAL');
        if (r === 'FILTER_MIN_QTY') blockReasons.push('FILTER_MIN_QTY');
        if (r === 'FILTER_MAX_QTY') blockReasons.push('FILTER_MAX_QTY');
        if (r === 'FILTER_STEP_SIZE_INVALID') blockReasons.push('FILTER_STEP_SIZE_INVALID');
        if (r === 'FILTER_TICK_SIZE_INVALID') blockReasons.push('FILTER_TICK_SIZE_INVALID');
        if (r === 'FILTER_PRICE_INVALID') blockReasons.push('FILTER_PRICE_INVALID');
        if (r === 'FILTER_QUANTITY_INVALID') blockReasons.push('FILTER_QUANTITY_INVALID');
      }
      for (const w of filterValidation.warnings) warnings.push(w);
    }

    const verdict = blockReasons.length > 0 ? 'BLOCK' : 'ALLOW';

    if (verdict === 'BLOCK') {
      logger.warn(`RiskEngine [${input.symbol}]: BLOCKED — ${blockReasons.join(', ')}`);
    }

    maxAllowedExposureUsd = effectiveMaxSize;

    return {
      verdict,
      blockReasons,
      warnings,
      requiredNextActions: verdict === 'BLOCK' ? ['Review risk limits before retrying'] : [],
      explanation: verdict === 'ALLOW'
        ? `Risk check passed for ${input.symbol}`
        : `Risk blocked: ${blockReasons.join(', ')}`,
      maxAllowedQuantity: maxAllowedQty,
      maxAllowedExposureUsd,
      remainingDailyLossUsd,
      remainingDailyTrades,
      groupExposureAfterTrade,
      configSnapshot: this.buildConfigSnapshot(),
      filterValidation,
      roundedQuantity: filterValidation?.roundedQuantity ?? input.quantity,
      roundedPrice: filterValidation?.roundedPrice ?? input.price,
      finalNotional: filterValidation?.notional ?? input.estimatedValue,
    };
  }

  private computeMaxAllowedQuantity(input: RiskInput): number {
    const maxSizeByPct = input.accountBalance * (this.config.maxPositionSizePercent / 100);
    const effectiveMaxSize = Math.min(maxSizeByPct, this.config.maxPositionSizeUsd);
    const maxQty = input.price > 0 ? effectiveMaxSize / input.price : 0;
    return Math.max(0, maxQty);
  }

  private estimateTotalExposure(input: RiskInput): number {
    return input.totalOpenPositions * input.estimatedValue;
  }

  private buildConfigSnapshot(): Record<string, unknown> {
    return {
      maxDailyLossPercent: this.config.maxDailyLossPercent,
      maxDailyLossUsd: this.config.maxDailyLossUsd,
      maxDrawdownPercent: this.config.maxDrawdownPercent,
      maxPositionSizePercent: this.config.maxPositionSizePercent,
      maxPositionSizeUsd: this.config.maxPositionSizeUsd,
      maxCapitalAtRiskPerTrade: this.config.maxCapitalAtRiskPerTrade,
      maxCapitalAtRiskTotal: this.config.maxCapitalAtRiskTotal,
      maxDailyTrades: this.config.maxDailyTrades,
      maxConsecutiveLosses: this.config.maxConsecutiveLosses,
      minWinRate: this.config.minWinRate,
    };
  }
}
