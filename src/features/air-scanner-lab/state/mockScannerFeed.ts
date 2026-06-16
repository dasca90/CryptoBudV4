import type { MockScannerCoin, OpenPositionVisualRow } from './airScannerVisualState';

export const mockScannerCoins: MockScannerCoin[] = [
  {
    symbol: 'UNIUSDT',
    base: 'UNI',
    price: '$13.74',
    score: 92,
    rawState: 'buy_candidate',
    isSelectedBuy: true,
    badge: 'BUY',
    position: [0.25, 2.25, 0],
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
    position: [-3.05, 1.75, 0.7],
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
    position: [3.45, 1.9, 0.25],
    group: 'High Risk',
    risk: 'High',
  },
  { symbol: 'TRXUSDT', base: 'TRX', price: '$0.138', score: 64, rawState: 'scanning', position: [0.2, 3.85, -0.75], group: 'Top Caps', risk: 'Top' },
  { symbol: 'BNBUSDT', base: 'BNB', price: '$617.42', score: 68, rawState: 'neutral', position: [2.4, 3.1, -0.85], group: 'Top Caps', risk: 'Top' },
  { symbol: 'NEARUSDT', base: 'NEAR', price: '$6.21', score: 63, rawState: 'neutral', position: [-2.35, 3.02, -0.8], group: 'Large Caps', risk: 'Mid' },
  { symbol: 'POLUSDT', base: 'POL', price: '$0.742', score: 58, rawState: 'neutral', position: [-2.6, 0.92, 1.15], group: 'Mid Caps', risk: 'Mid' },
  { symbol: 'INJUSDT', base: 'INJ', price: '$21.14', score: 61, rawState: 'scanning', position: [1.1, 0.55, 1.2], group: 'High Risk', risk: 'High' },
  { symbol: 'DYDXUSDT', base: 'DYDX', price: '$1.37', score: 55, rawState: 'neutral', position: [2.55, 1.1, 1.05], group: 'High Risk', risk: 'High' },
  { symbol: 'SPXUSDT', base: 'SPX', price: '$1.32', score: 50, rawState: 'neutral', position: [-4.1, 1.55, 0.1], group: 'Very High Risk', risk: 'High' },
];

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
