export type NavTabKey =
  | "Overview"
  | "Scanner"
  | "Positions"
  | "Strategies"
  | "Markets"
  | "Alerts"
  | "Journal"
  | "Reports"
  | "ML Lab"
  | "Settings";

const TAB_SYMBOLS: Record<NavTabKey, string> = {
  Overview: "⌂",
  Scanner: "◎",
  Positions: "▣",
  Strategies: "◈",
  Markets: "◌",
  Alerts: "⚑",
  Journal: "▤",
  Reports: "◫",
  "ML Lab": "◍",
  Settings: "⚙",
};

const TITLE_SYMBOLS: Record<string, string> = {
  "3D AIR SCANNER": "◉",
  "SELECTED COIN": "◈",
  "THE DIPPER": "◍",
  "MARKET REGIME": "◐",
  "ACTIVE STRATEGY": "◌",
  "RISK SUMMARY": "◔",
  "OPEN POSITIONS": "▣",
  "CLOSED POSITIONS": "▤",
  "TOP CANDIDATES": "◎",
};

const COIN_SYMBOLS: Record<string, string> = {
  BTC: "₿",
  ETH: "Ξ",
  SOL: "◈",
  XRP: "✕",
  ADA: "◍",
  BNB: "◇",
  DOGE: "◉",
  DOT: "◌",
  LINK: "⬢",
  AVAX: "△",
  LTC: "Ł",
  PEPE: "◒",
  MATIC: "⬡",
  TRX: "▵",
  TON: "◐",
};

export function getTabSymbol(tab: NavTabKey): string {
  return TAB_SYMBOLS[tab] ?? "•";
}

export function getTitleSymbol(title: string): string {
  return TITLE_SYMBOLS[title.toUpperCase()] ?? "•";
}

export function getCoinRepresentative(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  return COIN_SYMBOLS[base] ?? base.slice(0, 2);
}

