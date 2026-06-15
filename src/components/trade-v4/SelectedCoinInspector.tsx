import { useEffect, useRef, useState } from "react";
import { logger } from "../../utils/logger";
import type { TradeV4CandidateView, TradeV4NoBuyDisplay, TradeV4OpenPositionView, TradeV4ClosedPositionView } from "./types";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";
import { getTrendColor, getTrendClassName, getTrendGlow } from "../../lib/ui/trendColorHelper";
import { getBlockerExplanation } from "../../lib/ui/blockerExplanations";
import { getExecutionStageDisplay, sanitizeExecutionDisplayText } from "../../lib/execution/executionDisplay";

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
  const [detailedMode, setDetailedMode] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const containerWidth = cardRef.current?.clientWidth ?? 0;
    const contentWidth = contentRef.current?.scrollWidth ?? 0;
    const contentEl = contentRef.current;
    const overflowDetected = !!contentEl && (contentEl.scrollHeight > contentEl.clientHeight || contentWidth > containerWidth);
    logger.info(`SELECTED_COIN_CARD_LAYOUT_AUDIT: symbol=${c?.symbol ?? 'none'} renderedFields=symbol|buy_button|score|confidence|risk_group|spread|auto_tp1|tp_range|confidence_tier|max_tp|auto_tp_reason|group_trend|group_strategy|effective_strategy|status|reason|setup hiddenFields=none overflowDetected=${String(overflowDetected)} compactMode=${String(!detailedMode)} detailedMode=${String(detailedMode)} containerWidth=${containerWidth} contentWidth=${contentWidth}`);
  }, [c?.symbol, detailedMode, c?.autoTpDecision?.reason, c?.groupTrend, c?.groupRecommendedStrategy, c?.effectiveStrategy]);

  if (!c) {
    return (
      <aside className="selected-coin-card" ref={cardRef}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div></div>
        <p style={{ marginTop: 12, color: '#8b949e', fontSize: 10 }}>Select a coin to see details. Market info moved to Execution Insights below Candidate Pool.</p>
      </aside>
    );
  }

  const canManualBuy = c.status !== "BLOCK" && c.status !== "AVOID";

  return (
    <aside className="selected-coin-card" ref={cardRef}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}><div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div>{c ? (<button className="panel-filter-btn" style={{ fontSize: 9, padding: "2px 8px" }} onClick={() => setDetailedMode(v => !v)}>{detailedMode ? "Detailed" : "Compact"}</button>) : null}</div>

      <div ref={contentRef} className="selected-coin-content"><div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, alignItems: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--cyan)" }}>{getCoinRepresentative(c.symbol)}</span>
          {c.symbol}
        </div>
        <div className="mono status-warn" style={{ border: "1px solid rgba(255,209,102,.4)", padding: "4px 10px", borderRadius: 8 }}>
          {c.status.toUpperCase()}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginTop: 22 }}>
        <Metric label="SCORE" value={c.score != null ? c.score.toFixed(1) : 'n/a'} tooltip="Raw scanner ranking score. Higher = stronger candidate. Not the same as confidence." />
        <Metric label="CONF" value={c.confidence > 0 ? `${Math.round(c.confidence)}%` : 'n/a'} good={c.confidence >= 70} tooltip="Confidence: 0-100%. Independent from score. n/a means not available." />
        <Metric label="RISK" value={c.riskGroup || "n/a"} />
        <Metric label="SPREAD" value={c.spreadPct !== null ? `${c.spreadPct.toFixed(2)}%` : "n/a"} />
      </div>

      {c.autoTpDecision && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginTop: 8 }}>
          <Metric label="AUTO TP1" value={`${c.autoTpDecision.tp1Pct.toFixed(1)}%`} good={c.autoTpDecision.tp1Pct > 0} />
          <Metric label="TP RANGE" value={`${c.autoTpDecision.rangeMin}–${c.autoTpDecision.rangeMax}%`} />
          <Metric label="CONF TIER" value={c.autoTpDecision.confidenceTier} />
          <Metric label="MAX TP" value={c.autoTpDecision.usedMaxRange ? 'Allowed' : 'Capped'} good={c.autoTpDecision.usedMaxRange} />
        </div>
      )}
      {c.autoTpDecision && (
        <div style={{ fontSize: 9, color: '#8b949e', marginTop: 4, padding: '3px 6px', background: 'rgba(139,148,158,0.08)', borderRadius: 4 }}>
          Auto TP reason: {c.autoTpDecision.reason}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8, marginTop: 10 }}>
        <div className="panel" style={{ padding: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>GROUP TREND</div>
          <strong className={`${getTrendClassName(c.groupTrend)} ${getTrendGlow(c.groupTrend)}`}>{c.groupTrend || "n/a"}</strong>
        </div>
        <Metric label="GROUP STRAT" value={c.groupRecommendedStrategy || "n/a"} />
        <Metric label="EFFECTIVE" value={c.effectiveStrategy || "n/a"} />
        <Metric label="SOURCE" value={c.strategySource || "n/a"} />
      </div>

      {c.requiredNextAction && (
        <div style={{ fontSize: 10, color: '#f0883e', marginTop: 8, padding: '4px 8px', background: 'rgba(240,136,62,0.1)', borderRadius: 4 }}>
          Required next: {c.requiredNextAction}
        </div>
      )}
      {(c.gateAudit || c.strategyAudit) && (
        <section className="panel" style={{ padding: 10, marginTop: 10 }}>
          <div className="panel-title">FINAL GATE STATUS</div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 6 }}>
            Market action: {props.noBuyDisplay?.marketAction ?? 'n/a'}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            Candidate status: {c.status} | finalExecutable: {String(c.finalExecutable)} | buyAllowed: {String(c.buyAllowed)}
          </div>
          <div style={{ fontSize: 10, color: '#f85149', marginTop: 4 }}>
            Why: {c.primaryBlocker || c.gateAudit?.blocker || c.mainReason || 'n/a'}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>
            Spread: {c.gateAudit ? `${c.gateAudit.spreadPct.toFixed(2)}% / max ${c.gateAudit.maxSpreadUsedByEntryGate.toFixed(2)}%` : 'n/a'}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            Slippage: {c.gateAudit ? `${c.gateAudit.slippagePct.toFixed(2)}% / max ${c.gateAudit.maxSlippageUsed.toFixed(2)}%` : 'n/a'}
          </div>
          {c.gateAudit?.setupMissing?.length ? (
            <div style={{ fontSize: 9, color: '#d29922', marginTop: 4 }}>
              Setup missing: {c.gateAudit.setupMissing.join(', ')}
            </div>
          ) : null}
        </section>
      )}

      {c.autoStrategyReason && (
        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 8, padding: '4px 8px', background: 'rgba(139,148,158,0.08)', borderRadius: 4 }}>
          Strategy: {c.autoStrategyReason}
        </div>
      )}

      {c.autoStrategyWarnings && c.autoStrategyWarnings.length > 0 && (
        <div style={{ fontSize: 9, color: '#d29922', marginTop: 8, padding: '4px 8px', background: 'rgba(210,153,34,0.06)', borderRadius: 4 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>AutoBots evaluated:</div>
          {c.autoStrategyWarnings.map((w, i) => (
            <div key={i} style={{ color: '#8b949e', lineHeight: '15px' }}>
              {w.startsWith('GROUP_') ? '• ' + w.replace(/GROUP_/g, 'Group: ') :
               w.startsWith('ML_') ? '• ML: ' + w.replace('ML_', '') :
               '• ' + w}
            </div>
          ))}
        </div>
      )}

      {c.strategyAudit && (
        <section className="panel" style={{ padding: 10, marginTop: 10 }}>
          <div className="panel-title">STRATEGY AUDIT</div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 6 }}>
            Strategy: <span style={{ color: '#58a6ff' }}>{c.strategyAudit.strategySelected}</span> | Source: <span style={{ color: '#7ee787' }}>{c.strategyAudit.strategySource}</span>
          </div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            Runtime: {c.strategyAudit.runtimeActiveStrategy} | Final rule: {c.strategyAudit.finalEntryRule}
          </div>
          {c.strategyAudit.dynamicSetupContext && (
            <div style={{ fontSize: 10, color: '#58a6ff', marginTop: 4 }}>
              Dynamic setup: {c.strategyAudit.dynamicSetupContext.marketRegimeBucket.replace(/_/g, ' ')} | Intended {c.strategyAudit.dynamicSetupContext.intendedStrategy} | Final {c.strategyAudit.dynamicSetupContext.finalStrategy} | Dip {String(c.strategyAudit.dynamicSetupContext.requiredDipPctMin ?? 'n/a')}–{String(c.strategyAudit.dynamicSetupContext.requiredDipPctMax ?? 'n/a')} | Rebound {String(c.strategyAudit.dynamicSetupContext.requiredReboundPctMin ?? 'n/a')}–{String(c.strategyAudit.dynamicSetupContext.requiredReboundPctMax ?? 'n/a')}
            </div>
          )}
          {c.strategyAudit.dynamicSetupContext && (
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>
              Actual dip/rebound: {String(c.strategyAudit.dynamicSetupContext.actualDipPct ?? 'n/a')} / {String(c.strategyAudit.dynamicSetupContext.actualReboundPct ?? 'n/a')} | Primary blocker: {c.strategyAudit.dynamicSetupContext.primaryBlocker} | Final executable: {String(c.strategyAudit.finalExecutable)}
            </div>
          )}
          <div style={{ fontSize: 10, color: c.strategyAudit.finalExecutable ? '#3fb950' : '#f85149', fontWeight: 700, marginTop: 4 }}>
            finalExecutable: {String(c.strategyAudit.finalExecutable)} | buyAllowed: {String(c.strategyAudit.buyAllowed)}
          </div>
          <div style={{ marginTop: 6 }}>
            {c.strategyAudit.setupRequired.slice(0, 12).map((s) => (
              <div key={s.key} style={{ fontSize: 9, color: s.passed ? '#3fb950' : (s.required ? '#f85149' : '#d29922') }}>
                {s.passed ? '?' : (s.required ? '?' : '•')} {s.label}{s.requiredValue != null ? ` (req ${String(s.requiredValue)})` : ''}{s.actualValue != null ? ` | actual ${String(s.actualValue)}` : ''}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>
            {(detailedMode ? c.strategyAudit.setupMetrics : c.strategyAudit.setupMetrics.slice(0, 10)).map((m) => (
              <div key={m.key} style={{ fontSize: 8, color: m.passed ? '#3fb950' : (m.role === 'required' || m.role === 'blocker' ? '#f85149' : '#d29922') }}>
                {m.key}: actual={String(m.actualValue)} req={String(m.requiredValue)} role={m.role} used={String(m.usedByStrategy)} src={m.sourceLayer}
              </div>
            ))}
          </div>
          {c.strategyAudit.setupMissing.length > 0 && (
            <div style={{ fontSize: 9, color: '#f85149', marginTop: 6 }}>
              Missing: {c.strategyAudit.setupMissing.map((s) => s.key).join(', ')}
            </div>
          )}
          {c.strategyAudit.blockReasons.length > 0 && (
            <div style={{ fontSize: 9, color: '#f85149', marginTop: 4 }}>
              Blocks: {c.strategyAudit.blockReasons.slice(0, 4).join(', ')}
            </div>
          )}
          {c.strategyAudit.warningReasons.length > 0 && (
            <div style={{ fontSize: 9, color: '#d29922', marginTop: 2 }}>
              Warnings: {c.strategyAudit.warningReasons.slice(0, 4).join(', ')}
            </div>
          )}
        </section>
      )}

      {c.strategySource === 'auto' || c.strategySource === 'group' ? (
        <div style={{ fontSize: 10, color: '#58a6ff', marginTop: 8, padding: '4px 8px', background: 'rgba(88,166,255,0.06)', borderRadius: 4 }}>
          Runtime rule: Auto — {c.strategySource === 'group' ? 'Group-decided' : 'AI-decided'} strategy applied.
        </div>
      ) : c.strategySource === 'manual' ? (
        <div style={{ fontSize: 10, color: '#7ee787', marginTop: 8, padding: '4px 8px', background: 'rgba(126,231,135,0.06)', borderRadius: 4 }}>
          Runtime rule: Manual override
        </div>
      ) : null}

      {(() => {
        const planSel = props.executionPlan?.selectedCandidates?.find(sc => sc.symbol === c.symbol);
        const planSkip = props.executionPlan?.skippedCandidates?.find(sc => sc.symbol === c.symbol);
        if (planSel) {
          return (
            <section className="panel" style={{ padding: 8, marginTop: 8 }}>
              <div className="panel-title">EXECUTION PLAN</div>
              <div style={{ fontSize: 10, color: '#2ea043', fontWeight: 600 }}>Selected — {planSel.plannedAction}</div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>Score: {planSel.score.toFixed(2)}</div>
              <div style={{ fontSize: 10, color: '#8b949e' }}>Reason: {planSel.reason}</div>
            </section>
          );
        }
        if (planSkip) {
          return (
            <section className="panel" style={{ padding: 8, marginTop: 8 }}>
              <div className="panel-title">EXECUTION PLAN</div>
              <div style={{ fontSize: 10, color: '#d29922', fontWeight: 600 }}>Skipped</div>
              <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>Gate: {planSkip.gate}</div>
              <div style={{ fontSize: 10, color: '#8b949e' }}>Reason: {planSkip.reason}</div>
              <div style={{ fontSize: 10, color: planSkip.isRetryable ? '#58a6ff' : '#f85149' }}>
                {planSkip.isRetryable ? 'Retryable' : 'Non-retryable'}
              </div>
            </section>
          );
        }
        return null;
      })()}

      {!props.executionPlan?.selectedCandidates?.some(sc => sc.symbol === c.symbol) && !props.executionPlan?.skippedCandidates?.some(sc => sc.symbol === c.symbol) && props.noBuyDisplay && (
        <section className="panel" style={{ padding: 8, marginTop: 8 }}>
          <div className="panel-title">NO-BUY DIAGNOSTICS</div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>
            Final reason: <span style={{ color: '#f85149' }}>{sanitizeExecutionDisplayText(props.noBuyDisplay.finalNoBuyReason ?? c.primaryBlocker ?? c.mainReason ?? 'waiting_for_confirmation')}</span>
          </div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            Ready: {props.noBuyDisplay.buyReadyCount ?? 0} | Blocked: {props.noBuyDisplay.blockedCount ?? 0} | Exec selected: {props.noBuyDisplay.selectedForExecutionCount ?? 0}
          </div>
          {(props.noBuyDisplay.requiredNextCondition?.length ?? 0) > 0 && (
            <div style={{ fontSize: 10, color: '#58a6ff', marginTop: 4 }}>
              Need: {props.noBuyDisplay.requiredNextCondition!.slice(0, 4).join(', ')}
            </div>
          )}
          {props.noBuyDisplay.topReasons.length > 0 && (
            <div style={{ fontSize: 9, color: '#d29922', marginTop: 4 }}>
              Top reasons: {props.noBuyDisplay.topReasons.slice(0, 4).map(sanitizeExecutionDisplayText).join(' | ')}
            </div>
          )}
        </section>
      )}

      {c && props.paperAutoResult && props.paperAutoResult.symbol === c.symbol && (
        <section className="panel" style={{ padding: 8, marginTop: 8 }}>
          <div className="panel-title">DEMO EXECUTION RESULT</div>
          <div style={{ fontSize: 10, color: (props.paperAutoResult.stage === 'PositionOpened' || props.paperAutoResult.executed) ? '#2ea043' : props.paperAutoResult.blocked ? '#f85149' : '#d29922', fontWeight: 600 }}>
            {(props.paperAutoResult.stage === 'PositionOpened' || props.paperAutoResult.executed) ? 'Executed' : props.paperAutoResult.blocked ? 'Blocked' : getExecutionStageDisplay(props.paperAutoResult.stage)}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>Reason: {sanitizeExecutionDisplayText(props.paperAutoResult.reason)}</div>
        </section>
      )}

      {props.openPosition && props.openPosition.symbol === c.symbol && (
        <section className="panel" style={{ padding: 8, marginTop: 8 }}>
          <div className="panel-title">OPEN POSITION</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 6 }}>
            <Metric label="Entry" value={props.openPosition.entryPrice.toFixed(4)} />
            <Metric label="Current" value={props.openPosition.livePrice.toFixed(4)} />
            <Metric label="PnL" value={`${props.openPosition.pnlPct.toFixed(2)}%`} good={props.openPosition.pnlPct >= 0} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 4 }}>
            <Metric label="TP1" value={props.openPosition.tp1Pct !== null ? `${props.openPosition.tp1Pct}%` : "n/a"} />
            <Metric label="TP2" value={props.openPosition.tp2Pct !== null ? `${props.openPosition.tp2Pct}%` : "n/a"} />
            <Metric label="SL" value={props.openPosition.slPct !== null ? `${props.openPosition.slPct}%` : "n/a"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 4 }}>
            <Metric label="Exit" value={props.openPosition.exitStatus} />
            <Metric label="Trail" value={props.openPosition.trailState} />
            <Metric label="Price" value={props.openPosition.priceQuality} />
          </div>
        </section>
      )}

      {props.closedPosition && props.closedPosition.symbol === c.symbol && (
        <section className="panel" style={{ padding: 8, marginTop: 8 }}>
          <div className="panel-title">LAST CLOSE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 6 }}>
            <Metric label="Reason" value={props.closedPosition.closeReason} />
            <Metric label="PnL" value={`${props.closedPosition.pnlPct.toFixed(2)}%`} good={props.closedPosition.pnlPct >= 0} />
            <Metric label="Price Q" value={props.closedPosition.closePriceQuality} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 4 }}>
            <Metric label="Duration" value={props.closedPosition.durationLabel} />
            <Metric label="Train" value={props.closedPosition.trainingEligible ? "Eligible" : "No"} good={props.closedPosition.trainingEligible} />
            <Metric label="ML" value={props.closedPosition.mlEligibility} />
          </div>
        </section>
      )}

      <section className="panel" style={{ padding: 12, marginTop: 14 }}>
        <div className="panel-title">SAFETY OVERLAY</div>
        {c.blockReasons?.length ? (
          <>
            <div style={{ fontSize: 10, color: '#f85149', fontWeight: 600, marginBottom: 6 }}>Safety Overlay: ON</div>
            <ol style={{ color: "var(--text-muted)", paddingLeft: 18, lineHeight: 1.8, fontSize: 9 }}>
              {c.blockReasons.slice(0, 6).map((reason) => {
                const explanation = getBlockerExplanation(reason);
                return (
                  <li key={reason} title={explanation || reason}>
                    {reason}
                    {explanation && <div style={{ fontSize: 8, color: '#7a8ea8', lineHeight: '14px' }}>{explanation}</div>}
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <>
            <div style={{ fontSize: 10, color: '#58a6ff' }}>Safety Overlay: OFF — No active filters blocking this coin.</div>
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>Next action: {c.requiredNextAction ? c.requiredNextAction : (c.mainReason || "Waiting for confirmation")}</div>
            {c.strategy === 'dip_and_rebound' && c.status !== 'BUY' && (
              <div style={{ fontSize: 8, color: '#58a6ff', marginTop: 2 }}>
                Conditions: rebound ? spread ? TP room ? price fresh
              </div>
            )}
            {c.strategy === 'momentum' && c.status !== 'BUY' && (
              <div style={{ fontSize: 8, color: '#58a6ff', marginTop: 2 }}>
                Conditions: momentum ? spread ? TP room ?
              </div>
            )}
          </>
        )}
        {c.autoTpDecision && (
          <div style={{ fontSize: 9, color: '#8b949e', marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
            <div>Auto TP: {c.autoTpDecision.tp1Pct.toFixed(1)}% (range {c.autoTpDecision.rangeMin}–{c.autoTpDecision.rangeMax}%)</div>
            <div>Conf tier: {c.autoTpDecision.confidenceTier}{c.autoTpDecision.downgradedByMarket ? ' · Market downgrade' : ''}{c.autoTpDecision.downgradedBySafety ? ' · Safety downgrade' : ''}</div>
          </div>
        )}
      </section>

      <section className="panel" style={{ padding: 12, marginTop: 14 }}>
        <div className="panel-title">ML SCORE</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <strong className={c.mlBadEntryRisk !== null ? "status-bad" : "status-good"}>{c.mlBadEntryRisk !== null ? `${c.mlBadEntryRisk.toFixed(1)}x` : "n/a"}</strong>
          <strong className="status-good">{c.dataQuality || "n/a"}</strong>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={() => props.onAddWatchlist(c.symbol)}>ADD TO WATCHLIST</button>
        <button className="btn btn-primary" disabled={!canManualBuy} onClick={() => props.onManualBuy(c.symbol)}>MANUAL BUY</button>
      </div>
      </div>
    </aside>
  );
}

function Metric(props: { label: string; value: string; good?: boolean; tooltip?: string }) {
  return (
    <div className="panel" style={{ padding: 10 }} title={props.tooltip}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", cursor: props.tooltip ? 'help' : undefined }}>{props.label}</div>
      <strong className={props.good ? "status-good" : ""}>{props.value}</strong>
    </div>
  );
}








