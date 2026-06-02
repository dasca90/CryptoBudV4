import { memo } from "react";
import type { TradeV4OpenPosition } from "../../types/trade-v4";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export const OpenPositionsPanel = memo(function OpenPositionsPanel(props: { positions: TradeV4OpenPosition[] }) {
  return (
    <section className="panel" style={{ padding: 12, overflow: "hidden" }}>
      <div className="panel-title">{getTitleSymbol("OPEN POSITIONS")} OPEN POSITIONS ({props.positions.length}/4)</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th><th>Entry</th><th>Price</th><th>PNL %</th><th>PNL $</th><th>TP</th><th>SL</th><th>Trail</th><th>Age</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {props.positions.map((p) => (
            <tr key={p.id}>
              <td><strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span>{getCoinRepresentative(p.symbol)}</span>{p.symbol}</strong></td>
              <td>{p.entryPrice}</td>
              <td>{p.livePrice}</td>
              <td className={p.pnlPct >= 0 ? "status-good" : "status-bad"}>{p.pnlPct.toFixed(2)}%</td>
              <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>${p.pnlUsd.toFixed(2)}</td>
              <td>{p.tpPct ?? "-"}%</td>
              <td>{p.slPct ?? "-"}%</td>
              <td>{p.trailState ?? "off"}</td>
              <td>{p.ageLabel}</td>
              <td className="status-good">{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});
