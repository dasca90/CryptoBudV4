export interface AiOpportunityScore {
  symbol: string;
  score: number;
  cleanUpsidePct: number;
  downsideRiskPct: number;
  riskRewardRatio: number;
  reason: string;
}
