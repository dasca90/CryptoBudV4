import type { TradeV4VisualState } from "../../components/trade-v4/types";
import type { ScannerCoinLifecycleState } from "./scannerCoinLifecycle";

export function lifecycleToVisualState(state: ScannerCoinLifecycleState | undefined, fallback: TradeV4VisualState): TradeV4VisualState {
  switch (state) {
    case "floating": return "floating";
    case "locked_for_buy": return "locked_for_buy";
    case "execution_submitted": return "execution_submitted";
    case "position_opened_hold": return "position_opened_hold";
    case "pull_to_center": return "pull_to_center";
    case "removed_from_scanner": return "removed_from_scanner";
    case "closed": return "closed";
    default: return fallback;
  }
}

export function shouldRenderScannerCoin(state: ScannerCoinLifecycleState | undefined): boolean {
  return state !== "removed_from_scanner" && state !== "closed";
}

export function freezesScannerCoin(state: ScannerCoinLifecycleState | undefined): boolean {
  return state === "locked_for_buy" || state === "execution_submitted" || state === "position_opened_hold";
}
