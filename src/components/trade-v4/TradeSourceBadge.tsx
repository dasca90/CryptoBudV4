import type { TradeSourcePresentation } from "../../core/notifications/trade-source";

export function TradeSourceBadge(props: {
  presentation?: TradeSourcePresentation | null;
  compact?: boolean;
  className?: string;
  title?: string;
}) {
  const p = props.presentation;
  if (!p) return <span className={`trade-source-badge source-unknown ${props.className ?? ""}`.trim()}>UNKNOWN</span>;
  const label = props.compact ? p.compactLabel : p.fullLabel;
  return (
    <span
      className={`trade-source-badge source-${p.badgeVariant} ${props.className ?? ""}`.trim()}
      title={props.title ?? `${p.fullLabel} | ${p.executionPath}`}
      data-source-variant={p.badgeVariant}
    >
      {label}
    </span>
  );
}

