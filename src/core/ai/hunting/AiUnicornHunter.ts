import type { AiDecisionInput } from '../AiTakeoverTypes';
import { rankAiOpportunities } from './AiCoinOpportunityRanker';

export function findAiUnicornCandidates(candidates: AiDecisionInput[], maxResults = 3, minCleanUpsidePct = 3): AiDecisionInput[] {
  const ranked = rankAiOpportunities(candidates);
  const symbols = new Set(ranked.filter((score) => score.cleanUpsidePct >= minCleanUpsidePct).slice(0, maxResults).map((score) => score.symbol));
  return candidates.filter((candidate) => symbols.has(candidate.symbol)).slice(0, maxResults);
}
