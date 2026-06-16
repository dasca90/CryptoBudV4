import { memo } from "react";
import type { AirCoinView } from "./types";
import { getCoinRepresentative } from "../../lib/ui/uiSymbolMapper";
import { getTrendColor } from "../../lib/ui/trendColorHelper";

const STATUS_COLORS: Record<string, string> = {
  BUY: '#3fb950',
  OPEN: '#3fb950',
  READY: '#58a6ff',
  SELECTED: '#bc8cff',
  SUBMITTED: '#f0883e',
  DUPLICATE: '#8b949e',
  'RISK BLOCK': '#f85149',
  EXHAUSTED: '#d29922',
  OVEREXTEND: '#d29922',
  SPREAD: '#f0883e',
  'NO TP': '#8b949e',
  WAIT: '#d29922',
  BLOCK: '#f85149',
  AVOID: '#f85149',
  open: '#3fb950',
};

export const AirCoinNode = memo(function AirCoinNode(props: {
  coin: AirCoinView;
  refCallback: (node: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  const { coin } = props;
  const hasConfidence = coin.confidence > 0;
  const statusColor = STATUS_COLORS[coin.status] || 'var(--text-muted)';
  const title = `${coin.symbol} — Score: ${coin.score != null ? coin.score.toFixed(1) : 'n/a'} (rank score, not confidence) — Conf: ${hasConfidence ? Math.round(coin.confidence) + '%' : 'n/a'} — ${coin.status}`;

  return (
    <button
      ref={props.refCallback}
      className={`air-coin air-coin-${coin.engineState}`}
      onClick={props.onClick}
      type="button"
      aria-label={`Select ${coin.symbol} — Score ${coin.score != null ? coin.score.toFixed(0) : 'n/a'}, Conf ${hasConfidence ? Math.round(coin.confidence) + '%' : 'n/a'}`}
      title={title}
    >
      <span className="air-coin-orb">
        <span className="air-coin-symbol">{getCoinRepresentative(coin.symbol)}</span>
        <span className="air-coin-ticker">{coin.symbol.replace("USDT", "")}</span>
        {coin.score != null ? (
          <span className="air-coin-score">S{coin.score.toFixed(0)}</span>
        ) : hasConfidence ? (
          <span className="air-coin-confidence">{Math.round(coin.confidence)}%</span>
        ) : (
          <span className="air-coin-noconf">n/a</span>
        )}
        <span className="air-coin-status" style={{ color: statusColor }}>{coin.status}</span>
      </span>
    </button>
  );
});
