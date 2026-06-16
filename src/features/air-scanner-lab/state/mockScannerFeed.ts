import type { MockScannerCoin, OpenPositionVisualRow } from './airScannerVisualState';

const primaryMockScannerCoins: MockScannerCoin[] = [
  {
    symbol: 'UNIUSDT',
    base: 'UNI',
    price: '$13.74',
    score: 92,
    rawState: 'buy_candidate',
    isSelectedBuy: true,
    badge: 'BUY',
    position: [0.25, 2.35, 0],
    group: 'Large Caps',
    risk: 'Mid',
  },
  {
    symbol: 'MATICUSDT',
    base: 'MATIC',
    price: '$0.732',
    score: 88,
    rawState: 'wait_candidate',
    badge: 'WAIT',
    position: [-3.75, 1.82, 0.35],
    group: 'Mid Caps',
    risk: 'Mid',
  },
  {
    symbol: 'SUIUSDT',
    base: 'SUI',
    price: '$0.846',
    score: 71,
    rawState: 'blocked_candidate',
    badge: 'BLOCKED',
    reasons: ['No take profit room', 'Spread too high', 'Duplicate lock', 'Risk block'],
    position: [4.25, 1.86, 0.4],
    group: 'High Risk',
    risk: 'High',
  },
  { symbol: 'TRXUSDT', base: 'TRX', price: '$0.138', score: 64, rawState: 'scanning', position: [0.15, 3.95, -1.25], group: 'Top Caps', risk: 'Top' },
  { symbol: 'BNBUSDT', base: 'BNB', price: '$617.42', score: 68, rawState: 'neutral', position: [3.15, 3.18, -1.35], group: 'Top Caps', risk: 'Top' },
  { symbol: 'NEARUSDT', base: 'NEAR', price: '$6.21', score: 63, rawState: 'neutral', position: [-3.45, 3.22, -1.45], group: 'Large Caps', risk: 'Mid' },
  { symbol: 'POLUSDT', base: 'POL', price: '$0.742', score: 58, rawState: 'neutral', position: [-4.1, 0.88, 1.85], group: 'Mid Caps', risk: 'Mid' },
  { symbol: 'INJUSDT', base: 'INJ', price: '$21.14', score: 61, rawState: 'scanning', position: [1.45, 0.62, 2.05], group: 'High Risk', risk: 'High' },
  { symbol: 'DYDXUSDT', base: 'DYDX', price: '$1.37', score: 55, rawState: 'neutral', position: [3.75, 1.1, 1.45], group: 'High Risk', risk: 'High' },
  { symbol: 'SPXUSDT', base: 'SPX', price: '$1.32', score: 50, rawState: 'neutral', position: [-5.05, 1.58, -1.05], group: 'Very High Risk', risk: 'High' },
];

const extraCoinSeeds = [
  ['APT', '$8.92', 72, 'Large Caps', 'Mid'],
  ['ARB', '$1.09', 69, 'Large Caps', 'Mid'],
  ['OP', '$2.01', 68, 'Large Caps', 'High'],
  ['ADA', '$0.462', 66, 'Top Caps', 'Top'],
  ['AVAX', '$35.21', 74, 'Large Caps', 'Mid'],
  ['LINK', '$15.82', 73, 'Top Caps', 'Top'],
  ['SOL', '$171.43', 78, 'Top Caps', 'Top'],
  ['ATOM', '$8.23', 62, 'Large Caps', 'Mid'],
  ['FTM', '$0.682', 59, 'High Risk', 'High'],
  ['IMX', '$1.24', 57, 'High Risk', 'Mid'],
  ['RUNE', '$4.78', 64, 'High Risk', 'High'],
  ['SEI', '$0.51', 63, 'Mid Caps', 'Mid'],
  ['TIA', '$6.44', 61, 'Mid Caps', 'Mid'],
  ['FET', '$1.78', 70, 'High Risk', 'High'],
  ['GRT', '$0.187', 58, 'Mid Caps', 'Mid'],
  ['AAVE', '$91.40', 67, 'Large Caps', 'Top'],
  ['LDO', '$2.32', 55, 'Mid Caps', 'Mid'],
  ['JUP', '$0.84', 60, 'High Risk', 'High'],
  ['PYTH', '$0.39', 56, 'High Risk', 'High'],
  ['TON', '$6.88', 75, 'Top Caps', 'Top'],
  ['DOGE', '$0.139', 52, 'Top Caps', 'High'],
  ['XRP', '$0.512', 65, 'Top Caps', 'Top'],
  ['FIL', '$5.41', 54, 'Mid Caps', 'Mid'],
  ['ETC', '$27.20', 51, 'Mid Caps', 'High'],
  ['BCH', '$421.80', 53, 'Top Caps', 'Top'],
  ['STX', '$1.82', 62, 'Mid Caps', 'High'],
  ['ICP', '$10.26', 60, 'Large Caps', 'Mid'],
  ['SAND', '$0.44', 49, 'Very High Risk', 'High'],
  ['GALA', '$0.031', 47, 'Very High Risk', 'High'],
  ['WIF', '$2.18', 46, 'Very High Risk', 'High'],
] as const;

const extraMockScannerCoins: MockScannerCoin[] = extraCoinSeeds.map(([base, price, score, group, risk], index) => {
  const ring = Math.floor(index / 10);
  const slot = index % 10;
  const angle = (slot / 10) * Math.PI * 2 + ring * 0.34;
  const radius = 2.85 + ring * 0.98 + (slot % 2) * 0.34;
  const height = 0.58 + (index % 4) * 0.46 + ring * 0.18;
  const rawState = index % 13 === 3 ? 'wait_candidate' : index % 17 === 5 ? 'blocked_candidate' : index % 4 === 0 ? 'scanning' : 'neutral';

  return {
    symbol: `${base}USDT`,
    base,
    price,
    score,
    rawState,
    badge: rawState === 'wait_candidate' ? 'WAIT' : rawState === 'blocked_candidate' ? 'BLOCKED' : undefined,
    reasons: rawState === 'blocked_candidate' ? ['Spread too high', 'Risk block'] : undefined,
    position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius * 0.82],
    group,
    risk,
  };
});

export const mockScannerCoins: MockScannerCoin[] = [...primaryMockScannerCoins, ...extraMockScannerCoins].slice(0, 40);

export const mockOpenPositions: OpenPositionVisualRow[] = [
  { symbol: 'AVAXUSDT', state: 'Running', entry: '$35.21', value: '$282.14', pnlPct: '+2.65%', pnlUsd: '+$7.27', risk: 'Mid' },
  { symbol: 'MATICUSDT', state: 'Running', entry: '$0.7012', value: '$239.75', pnlPct: '+1.82%', pnlUsd: '+$4.28', risk: 'Mid' },
  { symbol: 'LINKUSDT', state: 'Running', entry: '$15.82', value: '$219.49', pnlPct: '+1.15%', pnlUsd: '+$2.51', risk: 'Top' },
  { symbol: 'SOLUSDT', state: 'Running', entry: '$171.43', value: '$820.31', pnlPct: '+0.92%', pnlUsd: '+$7.46', risk: 'Top' },
];

export const confirmedUniPosition: OpenPositionVisualRow = {
  symbol: 'UNIUSDT',
  state: 'Open / Confirmed',
  entry: '$13.74',
  value: '$274.80',
  pnlPct: '+1.48%',
  pnlUsd: '+$4.07',
  risk: 'Mid',
  highlighted: true,
};

export const scanChecklist = [
  'Market structure',
  'Liquidity depth',
  'Volume momentum',
  'Spread analysis',
  'Orderbook health',
  'Risk assessment',
];
