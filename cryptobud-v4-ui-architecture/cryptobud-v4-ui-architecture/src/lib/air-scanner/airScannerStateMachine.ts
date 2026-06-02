import type { EngineState, VisualCoinState } from "../../types/trade-v4";

export function mapEngineToVisualState(
  engineState: EngineState,
  confidence: number,
  isSelected: boolean,
  hasOpenPosition: boolean,
): VisualCoinState {
  if (hasOpenPosition || engineState === "open") return "open";
  if (engineState === "closed") return "closed";
  if (engineState === "blocked" || engineState === "avoid") return "rejected";
  if (engineState === "order_pending") return "capturing";
  if (engineState === "approved") return "approved";
  if (isSelected || engineState === "engine_review") return "locked";
  if (confidence >= 70) return "detected";
  return "floating";
}

export function shouldAnimateCapture(state: VisualCoinState): boolean {
  return state === "approved" || state === "capturing";
}
