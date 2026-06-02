import { memo } from "react";
import type { TradeV4ClosedPosition } from "../../types/trade-v4";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export const ClosedPositionsPanel = memo(function ClosedPositionsPanel(props: { positions: TradeV4ClosedPosition[] }) {
  return (
    <section className="panel" style={{ padding: 12, overflow: "hidden" }}>
      <div className="panel-title">{getTitleSymbol("CLOSED POSITIONS")} CLOSED POSITIONS (TODAY {props.positions.length})</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbol</th><th>Entry</th><th>Exit</th><th>PNL %</th><th>PNL $</th><th>Reason</th><th>Quality</th><th>ML</th>
          </tr>
        </thead>
        <tbody>
          {props.positions.map((p) => (
            <tr key={p.id}>
              <td><strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span>{getCoinRepresentative(p.symbol)}</span>{p.symbol}</strong></td>
              <td>{p.entryPrice}</td>
              <td>{p.exitPrice}</td>
              <td className={p.pnlPct >= 0 ? "status-good" : "status-bad"}>{p.pnlPct.toFixed(2)}%</td>
              <td className={p.pnlUsd >= 0 ? "status-good" : "status-bad"}>${p.pnlUsd.toFixed(2)}</td>
              <td>{p.closeReason}</td>
              <td className={p.dataQuality === "GOOD" ? "status-good" : "status-warn"}>{p.dataQuality}</td>
              <td>{p.mlEligibility}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});
