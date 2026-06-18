import type { CSSProperties } from "react";
import { memo } from "react";
import { getCoinLogoMeta } from "../../lib/ui/uiSymbolMapper";

export const CoinLogo = memo(function CoinLogo(props: { symbol: string; size?: "sm" | "md" }) {
  const meta = getCoinLogoMeta(props.symbol);
  const sizeClass = props.size === "md" ? "coin-logo-md" : "coin-logo-sm";
  return (
    <span
      className={`coin-logo ${sizeClass}`}
      style={{ "--coin-logo-bg": meta.bg, "--coin-logo-fg": meta.fg, "--coin-logo-ring": meta.ring } as CSSProperties}
      aria-hidden="true"
      title={`${meta.base} logo`}
    >
      {meta.mark}
    </span>
  );
});

export function CoinSymbolCell(props: { symbol: string }) {
  const base = props.symbol.replace("USDT", "");
  return (
    <span className="coin-symbol-cell">
      <CoinLogo symbol={props.symbol} />
      <span className="coin-symbol-text">
        <strong>{base}</strong>
        <em>{props.symbol}</em>
      </span>
    </span>
  );
}
