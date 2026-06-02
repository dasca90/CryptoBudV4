import type { TradeV4CandidateView, TradeV4ClosedPositionView, TradeV4OpenPositionView, TradeV4PageModel } from "../../components/trade-v4/types";

export type ScannerCoinLifecycleState =
  | "floating"
  | "locked_for_buy"
  | "execution_submitted"
  | "position_opened_hold"
  | "pull_to_center"
  | "removed_from_scanner"
  | "closed";

export type ScannerCoinLifecycleEntry = {
  symbol: string;
  state: ScannerCoinLifecycleState;
  enteredAtMs: number;
  holdUntilMs?: number;
  pullStartedAtMs?: number;
  removeAfterMs?: number;
  linkedPositionId?: string;
  closedPositionId?: string;
  lastReason: string;
};

export type ScannerCoinLifecycleTransition = {
  symbol: string;
  from: ScannerCoinLifecycleState | "none";
  to: ScannerCoinLifecycleState;
  reason: string;
};

export type ScannerCoinLifecycleInput = {
  nowMs: number;
  candidates: TradeV4CandidateView[];
  openPositions: TradeV4OpenPositionView[];
  closedPositions: TradeV4ClosedPositionView[];
  executionPlan?: TradeV4PageModel["executionPlan"];
  paperAutoResult?: TradeV4PageModel["paperAutoResult"];
  holdMs?: number;
  pullMs?: number;
};

export type ScannerCoinLifecycleReduceResult = {
  entries: Map<string, ScannerCoinLifecycleEntry>;
  transitions: ScannerCoinLifecycleTransition[];
  hasActiveTimers: boolean;
};

const DEFAULT_HOLD_MS = 30_000;
const DEFAULT_PULL_MS = 2_000;

function setEntry(
  next: Map<string, ScannerCoinLifecycleEntry>,
  transitions: ScannerCoinLifecycleTransition[],
  prev: ScannerCoinLifecycleEntry | undefined,
  entry: ScannerCoinLifecycleEntry,
): void {
  next.set(entry.symbol, entry);
  if (!prev || prev.state !== entry.state) {
    transitions.push({ symbol: entry.symbol, from: prev?.state ?? "none", to: entry.state, reason: entry.lastReason });
  }
}

function isExecutionSubmitted(stage: string | undefined): boolean {
  return stage === "ExecutionSubmitted" || stage === "DemoFillCreated" || stage === "PaperFillCreated";
}

function selectedSymbols(plan: TradeV4PageModel["executionPlan"] | undefined): Set<string> {
  return new Set((plan?.selectedCandidates ?? []).filter((c) => c.plannedAction === "BUY").map((c) => c.symbol));
}

export function reduceScannerCoinLifecycle(
  previous: Map<string, ScannerCoinLifecycleEntry>,
  input: ScannerCoinLifecycleInput,
): ScannerCoinLifecycleReduceResult {
  const holdMs = input.holdMs ?? DEFAULT_HOLD_MS;
  const pullMs = input.pullMs ?? DEFAULT_PULL_MS;
  const next = new Map(previous);
  const transitions: ScannerCoinLifecycleTransition[] = [];
  const candidatesBySymbol = new Map(input.candidates.map((c) => [c.symbol, c]));
  const openBySymbol = new Map(input.openPositions.map((p) => [p.symbol, p]));
  const closedBySymbol = new Map(input.closedPositions.map((p) => [p.symbol, p]));
  const selected = selectedSymbols(input.executionPlan);
  const symbols = new Set<string>([
    ...previous.keys(),
    ...candidatesBySymbol.keys(),
    ...openBySymbol.keys(),
    ...closedBySymbol.keys(),
    ...selected,
  ]);
  if (input.paperAutoResult?.symbol) symbols.add(input.paperAutoResult.symbol);

  for (const symbol of symbols) {
    const prev = previous.get(symbol);
    const candidate = candidatesBySymbol.get(symbol);
    const openPosition = openBySymbol.get(symbol);
    const closedPosition = closedBySymbol.get(symbol);
    const exec = input.paperAutoResult?.symbol === symbol ? input.paperAutoResult : undefined;

    if (closedPosition) {
      setEntry(next, transitions, prev, {
        symbol,
        state: "closed",
        enteredAtMs: prev?.state === "closed" ? prev.enteredAtMs : input.nowMs,
        closedPositionId: closedPosition.id,
        lastReason: "real_position_closed",
      });
      continue;
    }

    if (openPosition) {
      if (prev?.state === "removed_from_scanner") {
        setEntry(next, transitions, prev, { ...prev, linkedPositionId: openPosition.id, lastReason: "open_position_still_visible_in_positions" });
      } else if (prev?.state === "pull_to_center") {
        if (prev.removeAfterMs && input.nowMs >= prev.removeAfterMs) {
          setEntry(next, transitions, prev, {
            ...prev,
            state: "removed_from_scanner",
            enteredAtMs: input.nowMs,
            linkedPositionId: openPosition.id,
            lastReason: "pull_animation_complete",
          });
        } else {
          setEntry(next, transitions, prev, { ...prev, linkedPositionId: openPosition.id, lastReason: "pull_animation_active" });
        }
      } else if (prev?.state === "position_opened_hold") {
        if (prev.holdUntilMs && input.nowMs >= prev.holdUntilMs) {
          setEntry(next, transitions, prev, {
            ...prev,
            state: "pull_to_center",
            enteredAtMs: input.nowMs,
            pullStartedAtMs: input.nowMs,
            removeAfterMs: input.nowMs + pullMs,
            linkedPositionId: openPosition.id,
            lastReason: "open_hold_elapsed",
          });
        } else {
          setEntry(next, transitions, prev, { ...prev, linkedPositionId: openPosition.id, lastReason: "real_open_position_hold" });
        }
      } else {
        setEntry(next, transitions, prev, {
          symbol,
          state: "position_opened_hold",
          enteredAtMs: input.nowMs,
          holdUntilMs: input.nowMs + holdMs,
          linkedPositionId: openPosition.id,
          lastReason: "real_open_position_detected",
        });
      }
      continue;
    }

    if (exec?.stage === "ExecutionFailed" || exec?.blocked) {
      if (candidate) {
        setEntry(next, transitions, prev, {
          symbol,
          state: "floating",
          enteredAtMs: prev?.state === "floating" ? prev.enteredAtMs : input.nowMs,
          lastReason: "execution_failed_or_blocked_no_position",
        });
      } else {
        next.delete(symbol);
      }
      continue;
    }

    if (exec && isExecutionSubmitted(exec.stage)) {
      setEntry(next, transitions, prev, {
        symbol,
        state: "execution_submitted",
        enteredAtMs: prev?.state === "execution_submitted" ? prev.enteredAtMs : input.nowMs,
        lastReason: "execution_started_waiting_for_real_position",
      });
      continue;
    }

    if (selected.has(symbol)) {
      setEntry(next, transitions, prev, {
        symbol,
        state: "locked_for_buy",
        enteredAtMs: prev?.state === "locked_for_buy" ? prev.enteredAtMs : input.nowMs,
        lastReason: "selected_for_buy_execution",
      });
      continue;
    }

    if (candidate) {
      setEntry(next, transitions, prev, {
        symbol,
        state: "floating",
        enteredAtMs: prev?.state === "floating" ? prev.enteredAtMs : input.nowMs,
        lastReason: "scanner_candidate_present",
      });
      continue;
    }

    if (prev?.state === "closed" || prev?.state === "removed_from_scanner") {
      next.delete(symbol);
    }
  }

  const hasActiveTimers = Array.from(next.values()).some((entry) => (
    entry.state === "position_opened_hold" || entry.state === "pull_to_center"
  ));
  return { entries: next, transitions, hasActiveTimers };
}

export function getPullProgress(entry: ScannerCoinLifecycleEntry | undefined, nowMs: number): number {
  if (!entry || entry.state !== "pull_to_center" || !entry.pullStartedAtMs || !entry.removeAfterMs) return 0;
  const total = Math.max(1, entry.removeAfterMs - entry.pullStartedAtMs);
  return Math.max(0, Math.min(1, (nowMs - entry.pullStartedAtMs) / total));
}
