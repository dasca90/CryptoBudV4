import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { logger } from "../../utils/logger";
import type { TradeV4CandidateView, TradeV4NoBuyDisplay, TradeV4OpenPositionView, TradeV4ClosedPositionView } from "./types";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";
import { getBlockerExplanation } from "../../lib/ui/blockerExplanations";
import { getExecutionStageDisplay, sanitizeExecutionDisplayText } from "../../lib/execution/executionDisplay";

type Verdict = "BUY READY" | "WAIT" | "BLOCKED" | "AVOID";

const BLOCKER_LABELS: Array<[RegExp, string]> = [
  [/finalExecutable_false/i, "Final gate did not approve BUY"],
  [/BLOCK_CONFIDENCE_TOO_LOW|confidence_below_tier|confidence.*below.*tier|confidence.*too low/i, "Confidence is too low"],
  [/BLOCK_BREAKOUT_NOT_CONFIRMED|breakout.*not.*confirmed|ltf.*not.*confirmed/i, "LTF breakout not confirmed"],
  [/waiting_for_confirmation|waiting.*confirmation|WAITING_FOR_SETUP/i, "Waiting for stronger confirmation"],
  [/rebound_not_confirmed|BLOCK_REBOUND_NOT_CONFIRMED/i, "Rebound is not confirmed yet"],
  [/momentum.*not.*confirmed|BLOCK_MOMENTUM_NOT_CONFIRMED/i, "Momentum is not confirmed"],
  [/spread.*too.*high|BLOCK_SPREAD_TOO_HIGH/i, "Spread is too high"],
  [/tp.*room|BLOCK_NO_TP_ROOM|no.*tp.*room/i, "TP room is limited"],
  [/duplicate|open.*position/i, "There is already an open or pending position"],
  [/price.*stale|BLOCK_PRICE_STALE/i, "Price data is stale"],
  [/risk|safety/i, "Safety rules blocked the entry"],
];

export function getSelectedCoinVerdict(candidate: TradeV4CandidateView): Verdict {
  if (candidate.status === "BUY") return "BUY READY";
  if (candidate.status === "AVOID") return "AVOID";
  if (candidate.status === "BLOCK") return "BLOCKED";
  return "WAIT";
}

export function translateBlocker(raw: string | null | undefined): string {
  const clean = sanitizeExecutionDisplayText(String(raw ?? "").trim());
  if (!clean || /^n\/a$|^ok$|^allow$/i.test(clean)) return "";
  for (const [pattern, label] of BLOCKER_LABELS) {
    if (pattern.test(clean)) return label;
  }
  const explanation = getBlockerExplanation(clean);
  if (explanation) return explanation;
  return clean
    .replace(/^BLOCK[_\s-]*/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildSelectedCoinMainReason(candidate: TradeV4CandidateView, reasons: string[]): string {
  const verdict = getSelectedCoinVerdict(candidate);
  const symbol = baseSymbol(candidate.symbol);
  if (verdict === "BUY READY") return `${symbol} is BUY READY because entry checks are currently aligned.`;
  const unique = uniqueStrings(reasons.map(translateBlocker).filter(Boolean));
  if (unique.length === 0) return `${symbol} is ${verdict} because the scanner is waiting for stronger confirmation.`;
  const main = unique.slice(0, 2).map(lowerFirst).join(" and ");
  return `${symbol} is ${verdict} because ${main}.`;
}

export function getTpRiskExplanation(candidate: TradeV4CandidateView): string {
  const tp = candidate.autoTpDecision;
  if (!tp) return "TP / risk data is not available for this coin yet.";
  const belowRange = tp.tp1Pct > 0 && tp.rangeMin > 0 && tp.tp1Pct < tp.rangeMin;
  const limitedRoom = /tp.*room|room.*limited|no.*room|capped/i.test(tp.reason);
  if (belowRange || limitedRoom) return "TP1 downgraded because TP room is limited.";
  const tp2 = tp.tp2Pct != null && tp.tp2Pct > 0 ? ` TP2 is ${tp.tp2Pct.toFixed(1)}%.` : "";
  return `TP1 is ${tp.tp1Pct.toFixed(1)}% inside the normal ${tp.rangeMin}-${tp.rangeMax}% range.${tp2}`;
}

export function getMlGuardExplanation(candidate: TradeV4CandidateView): string {
  if (candidate.mlBadEntryRisk == null) {
    return "ML Guard active, but no usable ML score for this coin.";
  }
  return `ML Guard score is ${candidate.mlBadEntryRisk.toFixed(1)}x bad-entry risk.`;
}

export function SelectedCoinInspector(props: {
  candidate?: TradeV4CandidateView;
  onManualBuy: (symbol: string) => void;
  onAddWatchlist: (symbol: string) => void;
  noBuyDisplay?: TradeV4NoBuyDisplay;
  openPosition?: TradeV4OpenPositionView;
  closedPosition?: TradeV4ClosedPositionView;
  executionPlan?: {
    selectedCandidates: Array<{ symbol: string; plannedAction: string; reason: string; score: number }>;
    skippedCandidates: Array<{ symbol: string; reason: string; gate: string; isRetryable: boolean }>;
  };
  paperAutoResult?: {
    attempted: boolean;
    executed: boolean;
    blocked: boolean;
    symbol: string;
    reason: string;
    gateResults: string[];
    stage?: 'PreCheckPassed' | 'ExecutionSubmitted' | 'DemoFillCreated' | 'PaperFillCreated' | 'PositionOpened' | 'ExecutionFailed';
  };
}) {
  const c = props.candidate;
  const [showRawAudit, setShowRawAudit] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const selectedContext = useMemo(() => {
    if (!c) return null;
    const planSkip = props.executionPlan?.skippedCandidates?.find(sc => sc.symbol === c.symbol);
    const rawReasons = uniqueStrings([
      c.primaryBlocker,
      c.gateAudit?.blocker,
      planSkip?.reason,
      c.mainReason,
      ...(c.blockReasons ?? []),
      ...(c.strategyAudit?.blockReasons ?? []),
      ...(c.gateAudit?.setupMissing ?? []),
      ...(c.strategyAudit?.setupMissing ?? []).map(item => item.label || item.key),
      ...(props.noBuyDisplay?.requiredNextCondition ?? []),
    ]).filter(reason => reason && !/^n\/a$|^ok$|^allow$/i.test(reason));
    const friendlyReasons = uniqueStrings(rawReasons.map(translateBlocker).filter(Boolean));
    return {
      verdict: getSelectedCoinVerdict(c),
      planSkip,
      rawReasons,
      friendlyReasons,
      mainReason: buildSelectedCoinMainReason(c, rawReasons),
      tpRisk: getTpRiskExplanation(c),
      mlGuard: getMlGuardExplanation(c),
    };
  }, [c, props.executionPlan, props.noBuyDisplay]);

  useEffect(() => {
    const containerWidth = cardRef.current?.clientWidth ?? 0;
    const contentWidth = contentRef.current?.scrollWidth ?? 0;
    const contentEl = contentRef.current;
    const overflowDetected = !!contentEl && (contentEl.scrollHeight > contentEl.clientHeight || contentWidth > containerWidth);
    logger.info(`SELECTED_COIN_CARD_LAYOUT_AUDIT: symbol=${c?.symbol ?? 'none'} renderedFields=verdict|main_reason|final_decision|entry_gate|professional_analysis|ml_guard|tp_risk|raw_audit_expandable hiddenFields=raw_audit_default overflowDetected=${String(overflowDetected)} compactMode=true detailedMode=${String(showRawAudit)} containerWidth=${containerWidth} contentWidth=${contentWidth}`);
  }, [c?.symbol, showRawAudit, selectedContext?.mainReason]);

  if (!c || !selectedContext) {
    return (
      <aside className="selected-coin-card" ref={cardRef}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div>
        </div>
        <p style={{ marginTop: 12, color: '#8b949e', fontSize: 10 }}>No coin selected. Select a coin to see details.</p>
      </aside>
    );
  }

  const canManualBuy = c.status !== "BLOCK" && c.status !== "AVOID";
  const planSelected = props.executionPlan?.selectedCandidates?.find(sc => sc.symbol === c.symbol);
  const statusTone = selectedContext.verdict === "BUY READY" ? "pill-green"
    : selectedContext.verdict === "AVOID" || selectedContext.verdict === "BLOCKED" ? "pill-red"
      : "pill-yellow";

  return (
    <aside className="selected-coin-card" ref={cardRef}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div>
        <button className="panel-filter-btn" style={{ fontSize: 9, padding: "2px 8px" }} onClick={() => setShowRawAudit(v => !v)}>
          {showRawAudit ? "Hide Raw" : "Raw Audit"}
        </button>
      </div>

      <div ref={contentRef} className="selected-coin-content">
        <section className="selected-verdict-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--cyan)" }}>{getCoinRepresentative(c.symbol)}</span>
                {c.symbol}
              </div>
              <div className="selected-main-reason">{selectedContext.mainReason}</div>
            </div>
            <span className={`v3-pill ${statusTone}`}>{selectedContext.verdict}</span>
          </div>
        </section>

        <InspectorSection title="Final Decision">
          <div className="selected-summary-grid">
            <Metric label="Verdict" value={selectedContext.verdict} good={selectedContext.verdict === "BUY READY"} />
            <Metric label="Strategy" value={c.effectiveStrategy || c.strategy || "n/a"} />
            <Metric label="Trend" value={c.displayTrend || c.groupTrend || "n/a"} />
          </div>
          <ReadableList items={selectedContext.friendlyReasons.slice(0, 4)} fallback="No blocking reason is active." tone={selectedContext.verdict === "BUY READY" ? "good" : "warn"} />
          {selectedContext.planSkip && (
            <div className="selected-note status-warn">Execution plan skipped this coin at {translateBlocker(selectedContext.planSkip.gate)}.</div>
          )}
          {planSelected && <div className="selected-note status-good">Execution plan selected this coin for {planSelected.plannedAction}.</div>}
        </InspectorSection>

        <InspectorSection title="Entry Gate">
          <div className="selected-summary-grid">
            <Metric label="Spread" value={c.gateAudit ? `${c.gateAudit.spreadPct.toFixed(2)}%` : c.spreadPct != null ? `${c.spreadPct.toFixed(2)}%` : "n/a"} good={c.gateAudit?.spreadOk ?? false} />
            <Metric label="Slippage" value={c.gateAudit ? `${c.gateAudit.slippagePct.toFixed(2)}%` : "n/a"} good={c.gateAudit?.slippageOk ?? false} />
            <Metric label="Next" value={translateBlocker(c.requiredNextAction) || "None"} />
          </div>
          <ReadableList items={uniqueStrings((c.gateAudit?.setupMissing ?? []).map(translateBlocker).filter(Boolean))} fallback="Entry gate has no visible missing checks." />
        </InspectorSection>

        <InspectorSection title="Smart / Professional Analysis">
          <div className="selected-summary-grid">
            <Metric label="Score" value={c.professionalScore != null ? c.professionalScore.toFixed(0) : "n/a"} good={(c.professionalScore ?? 0) >= 80} />
            <Metric label="Verdict" value={c.professionalVerdict || c.anchorDecision || "n/a"} />
            <Metric label="Risk" value={c.professionalRiskLabel || c.riskGroup || "n/a"} />
          </div>
          <ReadableList
            items={uniqueStrings([...(c.professionalBlockers ?? []), ...(c.professionalReasons ?? [])].map(translateBlocker).filter(Boolean)).slice(0, 4)}
            fallback="No Smart / Professional Analysis note is available for this coin."
          />
        </InspectorSection>

        <InspectorSection title="ML Guard">
          <div className="selected-note">{selectedContext.mlGuard}</div>
          <div className="selected-summary-grid">
            <Metric label="Data" value={c.dataQuality || "n/a"} good={c.dataQuality === "GOOD"} />
            <Metric label="Risk" value={c.mlBadEntryRisk != null ? `${c.mlBadEntryRisk.toFixed(1)}x` : "n/a"} />
            <Metric label="Conf" value={c.confidence > 0 ? `${Math.round(c.confidence)}%` : "n/a"} good={c.confidence >= 70} />
          </div>
        </InspectorSection>

        <InspectorSection title="TP / Risk">
          <div className="selected-note">{selectedContext.tpRisk}</div>
          <div className="selected-summary-grid">
            <Metric label="TP1" value={c.autoTpDecision ? `${c.autoTpDecision.tp1Pct.toFixed(1)}%` : props.openPosition?.tp1Pct != null ? `${props.openPosition.tp1Pct.toFixed(1)}%` : "n/a"} good={(c.autoTpDecision?.tp1Pct ?? props.openPosition?.tp1Pct ?? 0) > 0} />
            <Metric label="Range" value={c.autoTpDecision ? `${c.autoTpDecision.rangeMin}-${c.autoTpDecision.rangeMax}%` : "n/a"} />
            <Metric label="Risk" value={c.riskGroup || "n/a"} />
          </div>
          {props.openPosition && (
            <div className="selected-note">
              Open position: entry {props.openPosition.entryPrice.toFixed(4)}, live {props.openPosition.livePrice.toFixed(4)}, PnL {props.openPosition.pnlPct.toFixed(2)}%.
            </div>
          )}
          {props.closedPosition && (
            <div className="selected-note">
              Last close: {translateBlocker(props.closedPosition.closeReason)} with {props.closedPosition.pnlPct.toFixed(2)}% PnL.
            </div>
          )}
        </InspectorSection>

        {props.paperAutoResult && props.paperAutoResult.symbol === c.symbol && (
          <InspectorSection title="Execution Result">
            <div className={props.paperAutoResult.executed ? "status-good" : props.paperAutoResult.blocked ? "status-bad" : "status-warn"} style={{ fontSize: 10, fontWeight: 700 }}>
              {props.paperAutoResult.executed ? "Executed" : props.paperAutoResult.blocked ? "Blocked" : getExecutionStageDisplay(props.paperAutoResult.stage)}
            </div>
            <div className="selected-note">{translateBlocker(props.paperAutoResult.reason)}</div>
          </InspectorSection>
        )}

        <details className="panel selected-raw-audit" open={showRawAudit} onToggle={(event) => setShowRawAudit((event.currentTarget as HTMLDetailsElement).open)}>
          <summary>Raw Audit</summary>
          <pre>{JSON.stringify({
            finalExecutable: c.finalExecutable,
            buyAllowed: c.buyAllowed,
            primaryBlocker: c.primaryBlocker,
            mainReason: c.mainReason,
            blockReasons: c.blockReasons,
            gateAudit: c.gateAudit,
            strategyAudit: c.strategyAudit,
            noBuyDisplay: props.noBuyDisplay,
            autoTpDecision: c.autoTpDecision,
          }, null, 2)}</pre>
        </details>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <button className="btn" onClick={() => props.onAddWatchlist(c.symbol)}>ADD TO WATCHLIST</button>
          <button className="btn btn-primary" disabled={!canManualBuy} onClick={() => props.onManualBuy(c.symbol)}>MANUAL BUY</button>
        </div>
      </div>
    </aside>
  );
}

function InspectorSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="panel selected-inspector-section">
      <div className="panel-title">{props.title}</div>
      {props.children}
    </section>
  );
}

function ReadableList(props: { items: string[]; fallback: string; tone?: "good" | "warn" }) {
  if (props.items.length === 0) {
    return <div className={`selected-note ${props.tone === "good" ? "status-good" : ""}`}>{props.fallback}</div>;
  }
  return (
    <ul className="selected-readable-list">
      {props.items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function Metric(props: { label: string; value: string; good?: boolean; tooltip?: string }) {
  return (
    <div className="panel selected-metric" title={props.tooltip}>
      <div>{props.label}</div>
      <strong className={props.good ? "status-good" : ""}>{props.value}</strong>
    </div>
  );
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function baseSymbol(symbol: string): string {
  return symbol.toUpperCase().endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function lowerFirst(value: string): string {
  if (!value) return value;
  if (/^[A-Z]{2,}\b/.test(value)) return value;
  return value[0].toLowerCase() + value.slice(1);
}
