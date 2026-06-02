import { memo, useEffect, useMemo, useRef } from "react";
import type { AirCoin, TradeV4Candidate, TradeV4OpenPosition } from "../../types/trade-v4";
import { mapCandidatesToAirCoins } from "../../lib/air-scanner/airCoinVisualMapper";
import { updateAirCoinMotion } from "../../lib/air-scanner/airCoinMotion";
import { useRafLoop } from "../../hooks/useRafLoop";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { AirCoinNode } from "./AirCoin";

export const AirScanner3D = memo(function AirScanner3D(props: {
  candidates: TradeV4Candidate[];
  openPositions: TradeV4OpenPosition[];
  selectedSymbol?: string | null;
  active: boolean;
  onSelectSymbol: (symbol: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const coinRefs = useRef(new Map<string, HTMLButtonElement>());
  const coinsRef = useRef(new Map<string, AirCoin>());

  const mappedCoins = useMemo(() => {
    return mapCandidatesToAirCoins({
      candidates: props.candidates,
      openPositions: props.openPositions,
      selectedSymbol: props.selectedSymbol,
      previousCoins: coinsRef.current,
      maxVisible: 24,
    });
  }, [props.candidates, props.openPositions, props.selectedSymbol]);

  useEffect(() => {
    coinsRef.current = new Map(mappedCoins.map((coin) => [coin.symbol, coin]));
  }, [mappedCoins]);

  useRafLoop(props.active && !reducedMotion, (nowMs) => {
    coinsRef.current.forEach((coin, symbol) => {
      const next = updateAirCoinMotion(coin, nowMs);
      coinsRef.current.set(symbol, next);

      const node = coinRefs.current.get(symbol);
      if (!node) return;

      const depth = Math.max(0.45, Math.min(1.35, (next.z + 420) / 620));
      const opacity = Math.max(0.35, Math.min(1, (next.z + 360) / 520));

      node.style.transform = `translate3d(${next.x}px, ${next.y}px, ${next.z}px) scale(${depth})`;
      node.style.opacity = String(opacity);
      node.style.filter = `blur(${Math.max(0, 1.2 - depth)}px)`;
    });
  });

  return (
    <section className="air-scanner-3d">
      <header className="air-scanner-head">
        <div>
          <div className="panel-title">3D AIR SCANNER</div>
          <div className="legend">
            {["floating", "detected", "locked", "approved", "capturing", "open"].map((state) => (
              <span key={state}><i className={`dot dot-${state}`} /> {state}</span>
            ))}
          </div>
        </div>
        <div className="mono status-info">DEPTH 1000m</div>
      </header>

      <div className="scanner-space">
        <div className="scanner-grid" />
        <div className="scanner-core">
          <div className="capture-beam" />
          <div className="capture-ring ring-a" />
          <div className="capture-ring ring-b" />
        </div>

        {mappedCoins.map((coin) => (
          <AirCoinNode
            key={coin.symbol}
            coin={coin}
            refCallback={(node) => {
              if (node) coinRefs.current.set(coin.symbol, node);
              else coinRefs.current.delete(coin.symbol);
            }}
            onClick={() => props.onSelectSymbol(coin.symbol)}
          />
        ))}
      </div>
    </section>
  );
});
