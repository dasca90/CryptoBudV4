import { memo } from "react";
import type { AirCoin } from "../../types/trade-v4";
import { getCoinRepresentative } from "../../lib/ui/uiSymbolMapper";

export const AirCoinNode = memo(function AirCoinNode(props: {
  coin: AirCoin;
  refCallback: (node: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  const { coin } = props;

  return (
    <button
      ref={props.refCallback}
      className={`air-coin air-coin-${coin.visualState}`}
      onClick={props.onClick}
      type="button"
      aria-label={`Select ${coin.symbol}`}
    >
      <span className="air-coin-orb">
        <span className="air-coin-symbol">{getCoinRepresentative(coin.symbol)}</span>
        <span className="air-coin-ticker">{coin.symbol.replace("USDT", "")}</span>
        <span className="air-coin-confidence">{Math.round(coin.confidence)}%</span>
      </span>
    </button>
  );
});
