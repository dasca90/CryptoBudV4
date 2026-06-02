import { logger } from "../../utils/logger";
import type { ScannerCoinLifecycleState } from "./scannerCoinLifecycle";

export function logScannerCoinVisualState(symbol: string, from: ScannerCoinLifecycleState | "none", to: ScannerCoinLifecycleState, reason: string): void {
  logger.info(`SCANNER_COIN_VISUAL_STATE_AUDIT: symbol=${symbol} from=${from} to=${to} reason=${reason}`);
}

export function logScannerCoinFreeze(symbol: string, reason: string): void {
  logger.info(`SCANNER_COIN_FREEZE_TRIGGERED: symbol=${symbol} reason=${reason}`);
}

export function logScannerCoinOpenConfirmed(symbol: string, positionId: string | undefined): void {
  logger.info(`SCANNER_COIN_POSITION_OPEN_CONFIRMED: symbol=${symbol} positionId=${positionId ?? "unknown"}`);
}

export function logScannerCoinPullStarted(symbol: string): void {
  logger.info(`SCANNER_COIN_PULL_TO_CENTER_STARTED: symbol=${symbol}`);
}

export function logScannerCoinRemoved(symbol: string): void {
  logger.info(`SCANNER_COIN_REMOVED_FROM_SCANNER: symbol=${symbol}`);
}

export function logScannerCoinCloseSync(symbol: string, closedId: string | undefined): void {
  logger.info(`SCANNER_COIN_CLOSE_SYNC_AUDIT: symbol=${symbol} closedId=${closedId ?? "unknown"}`);
}
