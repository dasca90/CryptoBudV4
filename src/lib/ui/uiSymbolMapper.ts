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
  Overview: "OVR",
  Scanner: "SCN",
  Positions: "POS",
  Strategies: "STR",
  Markets: "MKT",
  Alerts: "ALR",
  Journal: "JRN",
  Reports: "RPT",
  "ML Lab": "ML",
  Settings: "SET",
};

const TITLE_SYMBOLS: Record<string, string> = {
  "3D AIR SCANNER": "AS",
  "SELECTED COIN": "SC",
  "THE DIPPER": "DP",
  "MARKET REGIME": "MR",
  "ACTIVE STRATEGY": "ST",
  "RISK SUMMARY": "RS",
  "OPEN POSITIONS": "OP",
  "CLOSED POSITIONS": "CP",
  "TOP CANDIDATES": "TC",
};

const COIN_SYMBOLS: Record<string, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  XRP: "XRP",
  ADA: "ADA",
  BNB: "BNB",
  DOGE: "DOGE",
  DOT: "DOT",
  LINK: "LINK",
  AVAX: "AVAX",
  LTC: "L",
  PEPE: "PEPE",
  MATIC: "MATIC",
  TRX: "TRX",
  TON: "TON",
};

export function getTabSymbol(tab: NavTabKey): string {
  return TAB_SYMBOLS[tab] ?? tab.slice(0, 2).toUpperCase();
}

export function getTitleSymbol(title: string): string {
  return TITLE_SYMBOLS[title.toUpperCase()] ?? title.replace(/\s+/g, '').slice(0, 2).toUpperCase();
}

export function getCoinRepresentative(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  return COIN_SYMBOLS[base] ?? base.slice(0, 4);
}

