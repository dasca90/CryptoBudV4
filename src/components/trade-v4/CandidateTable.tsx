import { memo } from "react";
import type { TradeV4CandidateView } from "./types";
import { getCoinRepresentative, getTitleSymbol } from "../../lib/ui/uiSymbolMapper";

export const CandidateTable = memo(function CandidateTable(props: {
  candidates: TradeV4CandidateView[];
  selectedSymbol?: string | null;
  onSelectSymbol: (symbol: string) => void;
  executionPlan?: {
    selectedCandidates: Array<{ symbol: string; plannedAction: string }>;
    skippedCandidates: Array<{ symbol: string; reason: string; gate: string }>;
  };
}) {
  const rows = props.candidates;

  return (
    <section className="panel" style={{ padding: 12, overflow: "hidden" }}>
      <div className="panel-title">{getTitleSymbol("TOP CANDIDATES")} TOP CANDIDATES</div>
      {rows.length === 0 ? (
        <div className="empty-state-small">No candidates yet.</div>
      ) : (
        <div className="table-scroll-x">
          <table className="data-table data-table-candidates">
            <thead>
              <tr>
                <th>Rank</th><th>Symbol</th><th>Risk Group</th><th>Strategy</th><th>Group Trend</th><th>Group Strategy</th><th>Effective</th><th>Status</th><th>Execution</th><th>Planned Action</th><th>Confidence</th><th>Spread</th><th>TP Room</th><th>Main Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, index) => (
                <tr
                  key={c.candidateId}
                  onClick={() => props.onSelectSymbol(c.symbol)}
                  style={{ cursor: "pointer", background: props.selectedSymbol === c.symbol ? "rgba(0,234,255,0.08)" : undefined }}
                >
                  <td>{c.rank ?? index + 1}</td>
                  <td><strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span>{getCoinRepresentative(c.symbol)}</span>{c.symbol}</strong></td>
                  <td>{c.riskGroup || "n/a"}</td>
                  <td>{c.strategy || "n/a"}</td>
                  <td>{c.groupTrend || "n/a"}</td>
                  <td>{c.groupRecommendedStrategy || "n/a"}</td>
                  <td>{c.effectiveStrategy || "n/a"}</td>
                  <td className="cand-status-fixed">{c.status}</td>
                  <td style={{ fontSize: 10 }}>
                    {props.executionPlan?.selectedCandidates?.find(sc => sc.symbol === c.symbol)
                      ? <span style={{ color: '#2ea043' }}>Selected</span>
                      : props.executionPlan?.skippedCandidates?.find(sc => sc.symbol === c.symbol)
                        ? <span style={{ color: '#d29922' }}>Skipped</span>
                        : <span style={{ color: '#8b949e' }}>Not evaluated</span>}
                  </td>
                  <td style={{ fontSize: 10 }}>
                    {props.executionPlan?.selectedCandidates?.find(sc => sc.symbol === c.symbol)?.plannedAction
                      ?? (c.status === 'WAIT' ? 'WAIT_ONLY' : c.status === 'BUY' ? 'PENDING' : 'SKIP')}
                  </td>
                  <td className={c.confidence >= 70 ? "status-good" : "status-warn"}>{c.confidence.toFixed(1)}%</td>
                  <td>{c.spreadPct !== null ? `${c.spreadPct.toFixed(2)}%` : "n/a"}</td>
                  <td>{c.tpRoomPct !== null ? `${c.tpRoomPct.toFixed(2)}%` : "n/a"}</td>
                  <td className="reason-cell" title={c.mainReason || c.blockReasons?.[0] || "n/a"}>{c.mainReason || c.blockReasons?.[0] || "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
});
