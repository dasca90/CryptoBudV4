import type { TradeV4CandidateView } from "../../components/trade-v4/types";

export function mapCandidateToVisualState(candidate: TradeV4CandidateView, isSelected: boolean, hasOpenPosition: boolean): TradeV4CandidateView["engineState"] {
  if (hasOpenPosition) return "open";
  if (candidate.status === "BLOCK") return "rejected";
  if (candidate.status === "BUY") return candidate.isOrderLocked ? "capturing" : "approved";
  if (candidate.status === "AVOID") return "floating";
  if (isSelected) return "locked";
  return candidate.confidence >= 70 ? "detected" : "floating";
}
