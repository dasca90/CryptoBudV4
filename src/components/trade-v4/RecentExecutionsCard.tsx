import { memo, useEffect, useState } from "react";
import { getRecentVisualExecutionEvents, subscribeVisualExecutionEvents } from "../../lib/air-scanner/executionVisualEventBus";
import { formatSystemLocalTime } from "../../utils/timeFormatter";
import { logger } from "../../utils/logger";

interface MiniLogRow {
  type: "BUY" | "SELL_PROFIT" | "SELL_LOSS";
  symbol: string;
  strategy: string;
  mode: string;
  timestamp: number;
  tradeId: string;
}

function eventToRow(event: any): MiniLogRow | null {
  if (event.event === "BUY_FILLED" || event.event === "POSITION_OPENED") {
    return { type: "BUY", symbol: event.symbol, strategy: event.strategy ?? "n/a", mode: event.mode ?? "demo", timestamp: event.timestamp, tradeId: event.tradeId };
  }
  if (event.event === "SELL_FILLED" || event.event === "TP1_FIXED") {
    return { type: "SELL_PROFIT", symbol: event.symbol, strategy: event.strategy ?? "n/a", mode: event.mode ?? "demo", timestamp: event.timestamp, tradeId: event.tradeId };
  }
  if (event.event === "STOP_LOSS" || event.event === "TRAILING_STOP") {
    return { type: "SELL_LOSS", symbol: event.symbol, strategy: event.strategy ?? "n/a", mode: event.mode ?? "demo", timestamp: event.timestamp, tradeId: event.tradeId };
  }
  return null;
}

export const RecentExecutionsCard = memo(function RecentExecutionsCard() {
  const [events, setEvents] = useState(getRecentVisualExecutionEvents());

  useEffect(() => {
    return subscribeVisualExecutionEvents(() => {
      setEvents(getRecentVisualExecutionEvents());
    });
  }, []);

  const rawRows = events.map(eventToRow).filter((r): r is MiniLogRow => r !== null);
  const seen = new Set<string>();
  const deduped = rawRows.filter(r => {
    const key = r.tradeId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const duplicates = rawRows.length - deduped.length;
  const rows = deduped.slice(0, 10);

  const buyCount = rows.filter(r => r.type === "BUY").length;
  const sellProfitCount = rows.filter(r => r.type === "SELL_PROFIT").length;
  const sellLossCount = rows.filter(r => r.type === "SELL_LOSS").length;

  logger.info(`MINILOG_BINDING_AUDIT: sourceUsed=executionVisualEventBus totalEventsAvailable=${events.length} buyCountAvailable=${events.filter(e => e.event === 'BUY_FILLED' || e.event === 'POSITION_OPENED').length} sellCountAvailable=${events.filter(e => e.event === 'SELL_FILLED' || e.event === 'TP1_FIXED' || e.event === 'STOP_LOSS' || e.event === 'TRAILING_STOP').length} renderedCount=${rows.length} latestEventType=${rows[0]?.type ?? 'none'} latestEventSymbol=${rows[0]?.symbol ?? 'none'} dedupApplied=${String(duplicates > 0)} duplicateCountRemoved=${duplicates}`);
  logger.info(`MINILOG_LAYOUT_AUDIT: targetRows=10 actualRowsVisible=${rows.length} cardHeight=n/a rowHeight=n/a overflowDetected=${String(rows.length > 10)}`);

  return (
    <div className="recent-exec-card panel-shell" data-testid="recent-executions-panel" style={{ flexShrink: 0, padding: '4px 8px', fontSize: 8, fontFamily: '"JetBrains Mono", monospace', background: 'rgba(6,16,26,0.92)', border: '1px solid rgba(0,234,255,0.15)', borderRadius: 4, minHeight: 20 }}>
      <div className="panel-title" style={{ fontSize: 9, marginBottom: 2 }}>LAST 10 OPERATIONS</div>
      {rows.length === 0 ? (
        <div style={{ color: '#484f58' }}>No operations yet.</div>
      ) : (
        rows.map((r, i) => (
          <div key={`${r.tradeId}-${i}`} style={{ color: r.type === "SELL_PROFIT" ? '#3fb950' : r.type === "SELL_LOSS" ? '#f85149' : '#58a6ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.5 }}>
            {r.type === "BUY" ? "BUY " : r.type === "SELL_PROFIT" ? "SELL+" : "SELL-"} | {formatSystemLocalTime(r.timestamp)} | {r.symbol} | {r.strategy} | {r.mode}
          </div>
        ))
      )}
    </div>
  );
});
