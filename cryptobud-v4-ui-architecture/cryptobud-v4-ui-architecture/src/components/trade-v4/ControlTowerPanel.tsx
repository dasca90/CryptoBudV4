import { getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export function ControlTowerPanel(props: {
  scannerRunning: boolean;
  candidateCount: number;
  engineReviewCount: number;
  openCount: number;
  closedTodayCount: number;
  capital: number;
  usedCapital: number;
}) {
  const usedPct = props.capital > 0 ? Math.round((props.usedCapital / props.capital) * 100) : 0;

  return (
    <aside className="control-tower panel">
      <Card title="THE DIPPER" status={props.scannerRunning ? "SCANNING" : "STOPPED"}>
        <Metric label="Last Scan" value="3s ago" />
        <Metric label="Candidates" value={props.candidateCount} />
        <Metric label="Engine Review" value={props.engineReviewCount} />
        <Metric label="Open Positions" value={props.openCount} />
        <Metric label="Closed Today" value={props.closedTodayCount} />
      </Card>

      <Card title="MARKET REGIME">
        <div className="status-good" style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Bullish With Caution</div>
        <Metric label="BTC Safety" value="OK" good />
        <Metric label="ETH Context" value="OK" good />
        <Metric label="Volatility" value="Medium" />
        <Metric label="Risk Mode" value="Balanced" />
      </Card>

      <Card title="ACTIVE STRATEGY">
        <div className="status-good" style={{ fontSize: 16, fontWeight: 700 }}>Balanced Dip & Rebound</div>
        <div style={{ height: 42, margin: "12px 0", borderRadius: 8, background: "linear-gradient(90deg, rgba(0,255,198,.15), transparent)" }} />
        <Metric label="Runtime Rule" value="Balanced" />
        <Metric label="Safety Overlay" value="Conservative ON" good />
      </Card>

      <Card title="RISK SUMMARY">
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: `conic-gradient(var(--green) ${usedPct}%, rgba(255,255,255,.08) 0)`,
            display: "grid", placeItems: "center",
          }}>
            <strong>{usedPct}%</strong>
          </div>
          <div style={{ flex: 1 }}>
            <Metric label="Capital" value={`$${props.capital.toFixed(2)}`} />
            <Metric label="Used" value={`$${props.usedCapital.toFixed(2)}`} />
            <Metric label="Available" value={`$${(props.capital - props.usedCapital).toFixed(2)}`} />
            <Metric label="Max Positions" value="4" />
            <Metric label="Risk Per Trade" value="$10 - $30" />
          </div>
        </div>
      </Card>
    </aside>
  );
}

function Card(props: { title: string; status?: string; children: React.ReactNode }) {
  return (
    <section className="panel" style={{ padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="panel-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--cyan)" }}>{getTitleSymbol(props.title)}</span>
          {props.title}
        </div>
        {props.status && <div className="status-good mono" style={{ fontSize: 10 }}>{props.status}</div>}
      </div>
      {props.children}
    </section>
  );
}

function Metric(props: { label: string; value: string | number; good?: boolean }) {
  return (
    <div className="metric-row">
      <span>{props.label}</span>
      <strong className={props.good ? "status-good" : ""}>{props.value}</strong>
    </div>
  );
}
