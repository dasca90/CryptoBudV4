import { useEffect, useMemo, useRef, useState } from "react";
import type { TradeV4CandidateView, TradeV4ClosedPositionView, TradeV4OpenPositionView, TradeV4PageModel } from "../../components/trade-v4/types";
import {
  reduceScannerCoinLifecycle,
  type ScannerCoinLifecycleEntry,
  type ScannerCoinLifecycleTransition,
} from "./scannerCoinLifecycle";
import {
  logScannerCoinCloseSync,
  logScannerCoinFreeze,
  logScannerCoinOpenConfirmed,
  logScannerCoinPullStarted,
  logScannerCoinRemoved,
  logScannerCoinVisualState,
} from "./scannerAnimationEvents";

function emitTransitionLogs(transitions: ScannerCoinLifecycleTransition[], entries: Map<string, ScannerCoinLifecycleEntry>): void {
  for (const t of transitions) {
    const entry = entries.get(t.symbol);
    logScannerCoinVisualState(t.symbol, t.from, t.to, t.reason);
    if (t.to === "locked_for_buy") logScannerCoinFreeze(t.symbol, t.reason);
    if (t.to === "position_opened_hold") logScannerCoinOpenConfirmed(t.symbol, entry?.linkedPositionId);
    if (t.to === "pull_to_center") logScannerCoinPullStarted(t.symbol);
    if (t.to === "removed_from_scanner") logScannerCoinRemoved(t.symbol);
    if (t.to === "closed") logScannerCoinCloseSync(t.symbol, entry?.closedPositionId);
  }
}

export function useScannerCoinAnimation(params: {
  candidates: TradeV4CandidateView[];
  openPositions: TradeV4OpenPositionView[];
  closedPositions: TradeV4ClosedPositionView[];
  executionPlan?: TradeV4PageModel["executionPlan"];
  paperAutoResult?: TradeV4PageModel["paperAutoResult"];
}) {
  const [entries, setEntries] = useState<Map<string, ScannerCoinLifecycleEntry>>(() => new Map());
  const entriesRef = useRef(entries);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestRef = useRef(params);
  latestRef.current = params;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    const reduced = reduceScannerCoinLifecycle(entriesRef.current, { ...latestRef.current, nowMs: Date.now() });
    entriesRef.current = reduced.entries;
    setEntries(reduced.entries);
    emitTransitionLogs(reduced.transitions, reduced.entries);
  }, [params.candidates, params.openPositions, params.closedPositions, params.executionPlan, params.paperAutoResult]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const hasTimers = Array.from(entries.values()).some((entry) => entry.state === "position_opened_hold" || entry.state === "pull_to_center");
    if (!hasTimers) return;

    timerRef.current = setInterval(() => {
      const reduced = reduceScannerCoinLifecycle(entriesRef.current, { ...latestRef.current, nowMs: Date.now() });
      entriesRef.current = reduced.entries;
      setEntries(reduced.entries);
      emitTransitionLogs(reduced.transitions, reduced.entries);
      if (!reduced.hasActiveTimers && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 250);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [entries]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return useMemo(() => ({
    lifecycleBySymbol: entries,
    activeLifecycleCount: entries.size,
    timerActive: Array.from(entries.values()).some((entry) => entry.state === "position_opened_hold" || entry.state === "pull_to_center"),
  }), [entries]);
}
