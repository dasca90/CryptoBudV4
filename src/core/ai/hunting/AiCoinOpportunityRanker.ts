import type { AiDecisionInput } from '../AiTakeoverTypes';
import type { AiOpportunityScore } from './AiOpportunityScore';

export function rankAiOpportunities(candidates: AiDecisionInput[]): AiOpportunityScore[] {
  return candidates
    .map((candidate) => {
      const upside = candidate.retrospective?.cleanUpsidePct ?? 0;
      const downside = candidate.retrospective?.downsideRiskPct ?? 0;
      const spreadPenalty = candidate.spreadPct * 10;
      const riskRewardRatio = downside > 0 ? upside / downside : upside;
      return {
        symbol: candidate.symbol,
        cleanUpsidePct: upside,
        downsideRiskPct: downside,
        riskRewardRatio,
        score: Math.max(0, upside * 12 + riskRewardRatio * 8 - spreadPenalty),
        reason: `upside=${upside.toFixed(2)} downside=${downside.toFixed(2)} rr=${riskRewardRatio.toFixed(2)}`,
      };
    })
    .sort((a, b) => b.score - a.score);
}
