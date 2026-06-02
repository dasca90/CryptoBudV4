import type { TradeV4Candidate } from "../../types/trade-v4";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export function SelectedCoinInspector(props: {
  candidate?: TradeV4Candidate;
  onManualBuy: (symbol: string) => void;
  onAddWatchlist: (symbol: string) => void;
}) {
  const c = props.candidate;

  if (!c) {
    return <aside style={{ padding: 16 }}><div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div><p>No coin selected.</p></aside>;
  }

  const canManualBuy = c.engineState !== "blocked" && c.engineState !== "avoid";

  return (
    <aside style={{ padding: 16 }}>
      <div className="panel-title">{getTitleSymbol("SELECTED COIN")} SELECTED COIN</div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, alignItems: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--cyan)" }}>{getCoinRepresentative(c.symbol)}</span>
          {c.symbol}
        </div>
        <div className="mono status-warn" style={{ border: "1px solid rgba(255,209,102,.4)", padding: "4px 10px", borderRadius: 8 }}>
          {c.engineState.toUpperCase()}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 22 }}>
        <Metric label="CONF" value={`${Math.round(c.confidence)}%`} good={c.confidence >= 70} />
        <Metric label="RISK" value={c.risk} />
        <Metric label="SPREAD" value={`${(c.spreadPct ?? 0).toFixed(2)}%`} />
        <Metric label="TP ROOM" value={`${(c.tpRoomPct ?? 0).toFixed(1)}%`} good={(c.tpRoomPct ?? 0) >= 2} />
      </div>

      <section className="panel" style={{ padding: 12, marginTop: 14 }}>
        <div className="panel-title">WHY NOT BUY YET</div>
        <ol style={{ color: "var(--text-muted)", paddingLeft: 18, lineHeight: 1.8 }}>
          {(c.blockReasons?.length ? c.blockReasons : [c.mainReason ?? "Waiting for confirmation"]).slice(0, 4).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ol>
      </section>

      <section className="panel" style={{ padding: 12, marginTop: 14 }}>
        <div className="panel-title">ML SCORE</div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <strong className={(c.mlScore ?? 0) >= 0 ? "status-good" : "status-bad"}>{(c.mlScore ?? 0).toFixed(2)}</strong>
          <strong className="status-good">{c.dataQuality ?? "UNKNOWN"}</strong>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <button className="btn" onClick={() => props.onAddWatchlist(c.symbol)}>ADD WATCHLIST</button>
        <button className="btn btn-primary" disabled={!canManualBuy} onClick={() => props.onManualBuy(c.symbol)}>MANUAL BUY</button>
      </div>
    </aside>
  );
}

function Metric(props: { label: string; value: string; good?: boolean }) {
  return (
    <div className="panel" style={{ padding: 10 }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{props.label}</div>
      <strong className={props.good ? "status-good" : ""}>{props.value}</strong>
    </div>
  );
}
