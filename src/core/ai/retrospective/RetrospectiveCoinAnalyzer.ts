import type { AiDecisionInput, AiRetrospectiveMetrics } from '../AiTakeoverTypes';

export interface RetrospectiveResult {
  present: boolean;
  verdict: 'CONFIRM' | 'BLOCK' | 'WARN';
  reason: string;
  metrics: AiRetrospectiveMetrics | null;
  warnings: string[];
}

export class RetrospectiveCoinAnalyzer {
  analyze(input: AiDecisionInput): RetrospectiveResult {
    if (input.retrospective) {
      const warnings: string[] = [];
      if (input.retrospective.candleExhaustion) warnings.push('CANDLE_EXHAUSTION');
      if (input.retrospective.overextended) warnings.push('OVEREXTENDED');
      if (input.retrospective.cleanUpsidePct <= 0) warnings.push('NO_CLEAN_UPSIDE');
      return {
        present: true,
        verdict: warnings.length > 0 ? 'WARN' : 'CONFIRM',
        reason: warnings.length > 0 ? warnings.join(', ') : 'Retrospective analysis present.',
        metrics: input.retrospective,
        warnings,
      };
    }

    const highLowRange = input.high24h > 0 && input.low24h > 0
      ? ((input.high24h - input.low24h) / input.low24h) * 100
      : 0;
    const resistanceDistancePct = input.price > 0 && input.high24h > 0
      ? ((input.high24h - input.price) / input.price) * 100
      : 0;
    const supportDistancePct = input.price > 0 && input.low24h > 0
      ? ((input.low24h - input.price) / input.price) * 100
      : 0;
    const metrics: AiRetrospectiveMetrics = {
      range1hPct: Math.abs(input.change1h),
      range4hPct: Math.abs(input.change1h) * 1.35,
      range24hPct: highLowRange,
      range3dPct: highLowRange,
      range7dPct: highLowRange,
      range21dPct: highLowRange,
      recentHighDistancePct: resistanceDistancePct,
      recentLowDistancePct: supportDistancePct,
      supportDistancePct,
      resistanceDistancePct,
      cleanUpsidePct: Math.max(0, resistanceDistancePct),
      downsideRiskPct: Math.abs(Math.min(0, supportDistancePct)),
      volatilityPct: highLowRange,
      averageReboundAfterDipPct: Math.max(0, input.change15m),
      pumpRiskPct: Math.max(0, input.change1h),
      candleExhaustion: input.change5m > 4 && input.change15m > 8,
      overextended: input.change1h > 10 || input.change24h > 25,
      liquidityDepthStatus: input.volume24h >= 100000 ? 'PASS' : 'FAIL',
      spreadStabilityStatus: input.spreadPct <= 0.35 ? 'PASS' : 'FAIL',
      volumeStabilityStatus: input.volume24h >= 100000 ? 'PASS' : 'WARN',
    };

    return {
      present: true,
      verdict: 'CONFIRM',
      reason: 'Retrospective metrics derived from local CryptoBud market data.',
      metrics,
      warnings: [],
    };
  }
}
