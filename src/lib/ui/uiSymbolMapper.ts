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

export interface CoinLogoMeta {
  base: string;
  mark: string;
  fg: string;
  bg: string;
  ring: string;
}

const COIN_LOGOS: Record<string, Omit<CoinLogoMeta, "base">> = {
  AAVE: { mark: "AAVE", fg: "#ffffff", bg: "linear-gradient(135deg, #b6509e, #2ebac6)", ring: "#8fd9ff" },
  ADA: { mark: "ADA", fg: "#ffffff", bg: "linear-gradient(135deg, #0033ad, #2a74ff)", ring: "#79a9ff" },
  ALLO: { mark: "ALLO", fg: "#f7fbff", bg: "linear-gradient(135deg, #536dfe, #00bcd4)", ring: "#8feeff" },
  APE: { mark: "APE", fg: "#ffffff", bg: "linear-gradient(135deg, #1457ff, #0b1b54)", ring: "#6ea2ff" },
  API3: { mark: "API3", fg: "#ffffff", bg: "linear-gradient(135deg, #001e3c, #00b2ff)", ring: "#72d7ff" },
  APT: { mark: "APT", fg: "#0b1117", bg: "linear-gradient(135deg, #f4f4f0, #86d8c5)", ring: "#dffdf6" },
  AVAX: { mark: "AVAX", fg: "#ffffff", bg: "linear-gradient(135deg, #e84142, #8f1d24)", ring: "#ff9a9a" },
  AVNT: { mark: "AVNT", fg: "#ffffff", bg: "linear-gradient(135deg, #20d6a3, #2255ff)", ring: "#8dffdf" },
  BANANAS31: { mark: "BN31", fg: "#261900", bg: "linear-gradient(135deg, #ffe45c, #2ed36e)", ring: "#fff4a8" },
  BCH: { mark: "BCH", fg: "#ffffff", bg: "linear-gradient(135deg, #8dc351, #0f8f46)", ring: "#aaff90" },
  BNB: { mark: "BNB", fg: "#171100", bg: "linear-gradient(135deg, #f3ba2f, #916400)", ring: "#ffdf70" },
  BTC: { mark: "BTC", fg: "#201200", bg: "linear-gradient(135deg, #f7931a, #f2c94c)", ring: "#ffd58a" },
  BTTC: { mark: "BTTC", fg: "#ffffff", bg: "linear-gradient(135deg, #0f2027, #2c5364)", ring: "#7bd7ff" },
  CFX: { mark: "CFX", fg: "#ffffff", bg: "linear-gradient(135deg, #111827, #f4a261)", ring: "#ffd098" },
  CHZ: { mark: "CHZ", fg: "#ffffff", bg: "linear-gradient(135deg, #e52020, #071a44)", ring: "#ff8585" },
  DOGE: { mark: "DOGE", fg: "#2b2100", bg: "linear-gradient(135deg, #c2a633, #f2d675)", ring: "#ffe99a" },
  DOT: { mark: "DOT", fg: "#ffffff", bg: "linear-gradient(135deg, #e6007a, #7c1e7a)", ring: "#ff8bd1" },
  EIGEN: { mark: "EIG", fg: "#ffffff", bg: "linear-gradient(135deg, #1a1044, #816bff)", ring: "#b8adff" },
  ENJ: { mark: "ENJ", fg: "#ffffff", bg: "linear-gradient(135deg, #624dbf, #1f8cff)", ring: "#a2c5ff" },
  ETH: { mark: "ETH", fg: "#ffffff", bg: "linear-gradient(135deg, #627eea, #1b2455)", ring: "#a6b8ff" },
  EUL: { mark: "EUL", fg: "#061b1a", bg: "linear-gradient(135deg, #78ffd6, #20c997)", ring: "#a8ffee" },
  FLOW: { mark: "FLOW", fg: "#002b22", bg: "linear-gradient(135deg, #00ef8b, #00a2ff)", ring: "#84ffd4" },
  FF: { mark: "FF", fg: "#ffffff", bg: "linear-gradient(135deg, #ff5c8a, #6236ff)", ring: "#ffa7c0" },
  INJ: { mark: "INJ", fg: "#ffffff", bg: "linear-gradient(135deg, #00f2fe, #4facfe)", ring: "#9af7ff" },
  JUP: { mark: "JUP", fg: "#ffffff", bg: "linear-gradient(135deg, #ff7a18, #af002d)", ring: "#ffb37a" },
  KAT: { mark: "KAT", fg: "#ffffff", bg: "linear-gradient(135deg, #20bf55, #01baef)", ring: "#89ffd5" },
  KITE: { mark: "KITE", fg: "#ffffff", bg: "linear-gradient(135deg, #3cd070, #0b6bcb)", ring: "#9fffc0" },
  LINEA: { mark: "LIN", fg: "#ffffff", bg: "linear-gradient(135deg, #111827, #6ee7ff)", ring: "#b7f4ff" },
  LINK: { mark: "LINK", fg: "#ffffff", bg: "linear-gradient(135deg, #2a5ada, #0f2d83)", ring: "#8caaff" },
  LTC: { mark: "LTC", fg: "#ffffff", bg: "linear-gradient(135deg, #345d9d, #9aa6b2)", ring: "#c3d2ff" },
  MATIC: { mark: "POL", fg: "#ffffff", bg: "linear-gradient(135deg, #8247e5, #3d1a8f)", ring: "#c3a1ff" },
  MMT: { mark: "MMT", fg: "#ffffff", bg: "linear-gradient(135deg, #00c2ff, #8b5cf6)", ring: "#acecff" },
  MORPHO: { mark: "MOR", fg: "#ffffff", bg: "linear-gradient(135deg, #1f7aff, #091a4a)", ring: "#80b4ff" },
  MUBARAK: { mark: "MUB", fg: "#ffffff", bg: "linear-gradient(135deg, #17c964, #006f3c)", ring: "#86ffb6" },
  NEAR: { mark: "NEAR", fg: "#101820", bg: "linear-gradient(135deg, #ffffff, #9bf6e4)", ring: "#f6fffb" },
  NOT: { mark: "NOT", fg: "#1b1300", bg: "linear-gradient(135deg, #ffd43b, #ff9f1c)", ring: "#ffe699" },
  OG: { mark: "OG", fg: "#ffffff", bg: "linear-gradient(135deg, #20c997, #2f80ed)", ring: "#98ffe6" },
  OSMO: { mark: "OSMO", fg: "#ffffff", bg: "linear-gradient(135deg, #6d28d9, #ec4899)", ring: "#d9a8ff" },
  PEPE: { mark: "PEPE", fg: "#062a10", bg: "linear-gradient(135deg, #38e54d, #9cff6b)", ring: "#b7ff9b" },
  POL: { mark: "POL", fg: "#ffffff", bg: "linear-gradient(135deg, #8247e5, #3d1a8f)", ring: "#c3a1ff" },
  RAY: { mark: "RAY", fg: "#ffffff", bg: "linear-gradient(135deg, #00f5ff, #7b2ff7)", ring: "#a7fbff" },
  RONIN: { mark: "RON", fg: "#ffffff", bg: "linear-gradient(135deg, #1273ea, #071a44)", ring: "#78b7ff" },
  SEI: { mark: "SEI", fg: "#ffffff", bg: "linear-gradient(135deg, #ef4444, #111827)", ring: "#ff9999" },
  SHIB: { mark: "SHIB", fg: "#ffffff", bg: "linear-gradient(135deg, #f97316, #7c2d12)", ring: "#ffc083" },
  SKL: { mark: "SKL", fg: "#ffffff", bg: "linear-gradient(135deg, #00d1ff, #2243b6)", ring: "#8cecff" },
  SOL: { mark: "SOL", fg: "#ffffff", bg: "linear-gradient(135deg, #14f195, #9945ff)", ring: "#9affdf" },
  SPELL: { mark: "SPL", fg: "#ffffff", bg: "linear-gradient(135deg, #7057ff, #00c8ff)", ring: "#b8a8ff" },
  SPX: { mark: "SPX", fg: "#ffffff", bg: "linear-gradient(135deg, #111827, #22c55e)", ring: "#82ffa7" },
  SUI: { mark: "SUI", fg: "#ffffff", bg: "linear-gradient(135deg, #4da2ff, #0b4c8c)", ring: "#a5d4ff" },
  SUN: { mark: "SUN", fg: "#2d1300", bg: "linear-gradient(135deg, #ffb703, #fb8500)", ring: "#ffd280" },
  TRX: { mark: "TRX", fg: "#ffffff", bg: "linear-gradient(135deg, #ff0013, #7f0010)", ring: "#ff7d86" },
  TON: { mark: "TON", fg: "#ffffff", bg: "linear-gradient(135deg, #0098ea, #004f9e)", ring: "#78ccff" },
  W: { mark: "W", fg: "#ffffff", bg: "linear-gradient(135deg, #00b4d8, #560bad)", ring: "#9defff" },
  XRP: { mark: "XRP", fg: "#ffffff", bg: "linear-gradient(135deg, #23292f, #5f6f7a)", ring: "#b7c4cc" },
  ZZ: { mark: "ZZ", fg: "#ffffff", bg: "linear-gradient(135deg, #22c55e, #0891b2)", ring: "#a7f3d0" },
};

export function getTabSymbol(tab: NavTabKey): string {
  return TAB_SYMBOLS[tab] ?? tab.slice(0, 2).toUpperCase();
}

export function getTitleSymbol(title: string): string {
  return TITLE_SYMBOLS[title.toUpperCase()] ?? title.replace(/\s+/g, '').slice(0, 2).toUpperCase();
}

export function getCoinRepresentative(symbol: string): string {
  const base = symbol.replace("USDT", "").toUpperCase();
  return getCoinLogoMeta(symbol).mark;
}

export function getCoinLogoMeta(symbol: string): CoinLogoMeta {
  const base = symbol.replace("USDT", "").toUpperCase();
  const known = COIN_LOGOS[base];
  if (known) return { base, ...known };
  const hue = base.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return {
    base,
    mark: base.slice(0, 4),
    fg: "#f7fbff",
    bg: `linear-gradient(135deg, hsl(${hue} 72% 42%), hsl(${(hue + 48) % 360} 78% 28%))`,
    ring: `hsl(${(hue + 24) % 360} 86% 72%)`,
  };
}

