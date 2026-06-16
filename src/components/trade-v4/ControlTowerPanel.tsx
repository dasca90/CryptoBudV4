import { useEffect, useMemo } from "react";
import { getTitleSymbol } from "../../lib/ui/uiSymbolMapper";
import { getTrendClassName, getTrendGlow } from "../../lib/ui/trendColorHelper";
import { getExecutionAdapterDisplay, getExecutionStageDisplay, sanitizeExecutionDisplayText } from "../../lib/execution/executionDisplay";
import { formatLocalTime } from "../../utils/timeFormatter";
import { logger } from "../../utils/logger";

export function ControlTowerPanel(props: {
  scannerRunning: boolean;
  candidateCount: number;
  engineReviewCount: number;
  openCount: number;
  closedTodayCount: number;
  capital: number;
  usedCapital: number;
  referencePeriod?: '1h' | '4h' | '1d' | '1w';
  marketPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  marketPeriodChangePct?: number | null;
  marketPeriodVolatility?: number | null;
  btcPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  ethPeriodTrend?: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | null;
  executionCanExecute?: boolean;
  executionNoBuyReasons?: string[];
  executionSelectedCount?: number;
  executionSkippedCount?: number;
  executionAdapter?: string;
  autoStrategySummary?: {
    totalCandidates: number;
    conservative: number;
    balanced: number;
    momentum: number;
    dip_and_rebound: number;
    wait: number;
    avoid: number;
    downgrades: number;
    referencePeriod: string;
  };
  paperAutoEnabled?: boolean;
  paperAutoResult?: {
    attempted: boolean;
    executed: boolean;
    blocked: boolean;
    symbol: string;
    reason: string;
    gateResults: string[];
    stage?: 'PreCheckPassed' | 'ExecutionSubmitted' | 'DemoFillCreated' | 'PaperFillCreated' | 'PositionOpened' | 'ExecutionFailed';
  };
  emptyUniverseReason?: string;
  lastScanAt?: string | null;
  dipperCardState?: {
    sourceUsed: string;
    lastCanonicalUpdateAt: string | null;
    scannerStatus: "RUNNING" | "WAITING" | "STOPPED";
    candidateCount: number;
    engineReviewCount: number;
    openPositionsCount: number;
    closedTodayCount: number;
    marketTrend: "BULLISH" | "BEARISH" | "SIDEWAYS" | null;
    btcContext: "BULLISH" | "BEARISH" | "SIDEWAYS" | null;
    ethContext: "BULLISH" | "BEARISH" | "SIDEWAYS" | null;
    strategyRef: string;
    capitalUsedPct: number;
    availableCapital: number;
  };
}) {
  const usedPct = props.capital > 0 ? Math.round((props.usedCapital / props.capital) * 100) : 0;
  const canonical = useMemo(() => ({
    lastScanAt: props.dipperCardState?.lastCanonicalUpdateAt ?? props.lastScanAt ?? null,
    scannerStatus: props.dipperCardState?.scannerStatus ?? (props.scannerRunning ? "RUNNING" : "STOPPED"),
    candidateCount: props.dipperCardState?.candidateCount ?? props.candidateCount,
    engineReviewCount: props.dipperCardState?.engineReviewCount ?? props.engineReviewCount,
    openCount: props.dipperCardState?.openPositionsCount ?? props.openCount,
    closedTodayCount: props.dipperCardState?.closedTodayCount ?? props.closedTodayCount,
    referencePeriod: props.dipperCardState?.strategyRef ?? props.referencePeriod ?? "1h",
    marketTrend: props.dipperCardState?.marketTrend ?? props.marketPeriodTrend ?? null,
    btcContext: props.dipperCardState?.btcContext ?? props.btcPeriodTrend ?? null,
    ethContext: props.dipperCardState?.ethContext ?? props.ethPeriodTrend ?? null,
    capitalUsedPct: props.dipperCardState?.capitalUsedPct ?? usedPct,
    availableCapital: props.dipperCardState?.availableCapital ?? (props.capital - props.usedCapital),
    sourceUsed: props.dipperCardState?.sourceUsed ?? "runtime_props_fallback",
  }), [props, usedPct]);

  useEffect(() => {
    const uiValue = [canonical.scannerStatus, canonical.candidateCount, canonical.engineReviewCount, canonical.openCount, canonical.closedTodayCount].join("|");
    const canonicalValue = [canonical.scannerStatus, canonical.candidateCount, canonical.engineReviewCount, canonical.openCount, canonical.closedTodayCount].join("|");
    const lastCanonicalTs = canonical.lastScanAt ? Date.parse(canonical.lastScanAt) : NaN;
    const now = Date.now();
    const staleDurationMs = Number.isFinite(lastCanonicalTs) ? Math.max(0, now - lastCanonicalTs) : -1;
    logger.info(`DIPPER_CARD_RENDER_AUDIT: uiValue=${uiValue} canonicalValue=${canonicalValue} sourceUsed=${canonical.sourceUsed} lastUiUpdateAt=${new Date(now).toISOString()} lastCanonicalUpdateAt=${canonical.lastScanAt ?? 'none'} staleDurationMs=${staleDurationMs} changedFields=auto renderReason=react_state_update`);
  }, [canonical, props]);

  const nowMs = Date.now();
  const lastScanTs = canonical.lastScanAt ? Date.parse(canonical.lastScanAt) : NaN;
  const staleDurationMs = Number.isFinite(lastScanTs) ? Math.max(0, nowMs - lastScanTs) : -1;
  const isStale = staleDurationMs >= 60000;
  const ageLabel = staleDurationMs >= 0
    ? staleDurationMs < 1000
      ? '0s ago'
      : `${Math.floor(staleDurationMs / 1000)}s ago`
    : 'n/a';

  return (
    <div className="dipper-panel panel">
      {props.executionNoBuyReasons && props.executionNoBuyReasons.length > 0 && (
        <Card title="EXECUTION PLAN" status={props.executionAdapter === 'binance_live' ? "LIVE" : props.executionCanExecute ? "READY" : "BLOCKED"}>
          <Row label="Status" value={props.executionCanExecute ? "Ready" : "Blocked"} good={props.executionCanExecute ?? false} />
          <Row label="Selected" value={String(props.executionSelectedCount ?? 0)} />
          <Row label="Skipped" value={String(props.executionSkippedCount ?? 0)} />
          <Row label="Mode" value={getExecutionAdapterDisplay(props.executionAdapter)} good={props.executionAdapter !== 'binance_live'} />
          <div style={{ fontSize: 9, color: '#d29922', marginTop: 2, wordBreak: 'break-word' }}>
            {props.executionNoBuyReasons.slice(0, 3).map(r => <div key={r}>• {r}</div>)}
          </div>
        </Card>
      )}

      {props.paperAutoEnabled !== undefined && (
        <section className={`panel ${props.paperAutoEnabled && props.scannerRunning ? 'paper-auto-pulse' : props.paperAutoResult?.blocked ? 'paper-auto-blocked-pulse' : ''}`} style={{ padding: 10, marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--cyan)" }}>{getTitleSymbol("AUTOBOTS")}</span>
              AutoBots
            </div>
          </div>
        </section>
      )}

      <Card title="THE DIPPER" status={props.scannerRunning ? "SCANNING" : "STOPPED"}>
        <Row
          label="Last Scan"
          value={canonical.lastScanAt ? `${formatLocalTime(canonical.lastScanAt, { format: 'time' })} · ${ageLabel}` : (props.scannerRunning ? "Active" : "Stopped")}
          tone={canonical.scannerStatus === "RUNNING" ? "good" : canonical.scannerStatus === "WAITING" ? "warn" : "bad"}
        />
        <Row label="Scanner Status" value={canonical.scannerStatus} tone={canonical.scannerStatus === "RUNNING" ? "good" : canonical.scannerStatus === "WAITING" ? "warn" : "bad"} />
        <Row label="Card Source" value={canonical.sourceUsed} tone="muted" />
        {isStale && (
          <Row label="Stale Warning" value={`STALE DATA > 60s (${Math.floor(staleDurationMs / 1000)}s)`} tone="bad" />
        )}
        {props.emptyUniverseReason && (
          <Row label="Universe" value={props.emptyUniverseReason} tone="warn" />
        )}
        <Row label="Reference Period" value={canonical.referencePeriod} tone="info" />
        <Row label="Candidates" value={String(canonical.candidateCount)} tone="info" />
        <Row label="Engine Review" value={String(canonical.engineReviewCount)} tone="info" />
        <Row label="Open Positions" value={String(canonical.openCount)} tone={canonical.openCount > 0 ? "good" : "muted"} />
        <Row label="Closed Today" value={String(canonical.closedTodayCount)} tone="muted" />

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />

        <TrendRow label="Market Trend" value={canonical.marketTrend} />
        <TrendRow label="BTC Context" value={canonical.btcContext} />
        <TrendRow label="ETH Context" value={canonical.ethContext} />
        <Row label="Volatility" value={props.marketPeriodVolatility != null ? `${props.marketPeriodVolatility.toFixed(2)}%` : 'n/a'} tone="info" />
        <Row label="Period Change" value={props.marketPeriodChangePct != null ? `${props.marketPeriodChangePct.toFixed(2)}%` : 'n/a'} tone="info" />

        {props.autoStrategySummary && (
          <>
            <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />
            <Row label="Strategy Ref" value={canonical.referencePeriod} tone="info" />
          </>
        )}

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '6px 0' }} />
        <Row label="Capital Used" value={`${canonical.capitalUsedPct}%`} tone={canonical.capitalUsedPct >= 80 ? "bad" : canonical.capitalUsedPct >= 50 ? "warn" : "good"} />
        <Row label="Available" value={`$${canonical.availableCapital.toFixed(2)}`} tone="info" />
      </Card>
    </div>
  );
}

function Card(props: { title: string; status?: string; children: React.ReactNode }) {
  const statusClass = props.status === 'SCANNING' ? 'status-good' : props.status === 'STOPPED' ? 'status-bad' : 'status-muted';
  return (
    <section className="panel" style={{ padding: 10, marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--cyan)" }}>{getTitleSymbol(props.title)}</span>
          {props.title}
        </div>
        {props.status && <div className={`${statusClass} mono`} style={{ fontSize: 9 }}>{props.status}</div>}
      </div>
      {props.children}
    </section>
  );
}

function TrendRow(props: { label: string; value: string | null | undefined }) {
  const v = props.value ?? 'n/a';
  return (
    <div className="metric-row" style={{ fontSize: 11, padding: '1px 0' }}>
      <span>{props.label}</span>
      <strong className={`${getTrendClassName(props.value)} ${getTrendGlow(props.value)}`}>{v}</strong>
    </div>
  );
}

function Row(props: { label: string; value: string; good?: boolean; tone?: "good" | "warn" | "bad" | "info" | "muted" }) {
  const toneClass = props.tone === "good" || props.good ? "status-good" : props.tone === "warn" ? "status-warn" : props.tone === "bad" ? "status-bad" : props.tone === "info" ? "status-info" : "status-muted";
  return (
    <div className="metric-row" style={{ fontSize: 11, padding: '1px 0' }}>
      <span>{props.label}</span>
      <strong className={toneClass}>{props.value}</strong>
    </div>
  );
}
