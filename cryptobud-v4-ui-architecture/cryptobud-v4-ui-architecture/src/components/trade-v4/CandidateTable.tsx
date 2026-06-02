import { memo } from "react";
import type { TradeV4Candidate } from "../../types/trade-v4";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export const CandidateTable = memo(function CandidateTable(props: {
  candidates: TradeV4Candidate[];
  selectedSymbol?: string | null;
  onSelectSymbol: (symbol: string) => void;
}) {
  const rows = props.candidates.slice(0, 50); // replace with virtualization for full table

  return (
    <section className="panel" style={{ padding: 12, overflow: "hidden" }}>
      <div className="panel-title">{getTitleSymbol("TOP CANDIDATES")} TOP CANDIDATES</div>
      <table className="data-table">
        <thead>
          <tr>
            <th>#</th><th>Symbol</th><th>Class</th><th>Strategy</th><th>Status</th><th>Conf</th><th>Dip %</th><th>Reb %</th><th>Spread</th><th>TP Room</th><th>Main Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, index) => (
            <tr
              key={c.symbol}
              onClick={() => props.onSelectSymbol(c.symbol)}
              style={{
                cursor: "pointer",
                background: props.selectedSymbol === c.symbol ? "rgba(0,234,255,0.08)" : undefined,
              }}
            >
              <td>{index + 1}</td>
              <td><strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span>{getCoinRepresentative(c.symbol)}</span>{c.symbol}</strong></td>
              <td>{c.className ?? c.risk}</td>
              <td>{c.strategy ?? "-"}</td>
              <td>{c.engineState}</td>
              <td className={c.confidence >= 70 ? "status-good" : "status-warn"}>{Math.round(c.confidence)}</td>
              <td>{c.dipPct?.toFixed(2) ?? "-"}</td>
              <td>{c.reboundPct?.toFixed(2) ?? "-"}</td>
              <td>{c.spreadPct?.toFixed(2) ?? "-"}%</td>
              <td>{c.tpRoomPct?.toFixed(1) ?? "-"}%</td>
              <td>{c.mainReason ?? c.blockReasons?.[0] ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
});
