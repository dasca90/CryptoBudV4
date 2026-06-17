import type { CoinVisualState, MockScannerCoin } from '../state/airScannerVisualState';

export function mapMockCoinToVisualState(coin: Pick<MockScannerCoin, 'rawState' | 'isSelectedBuy'>): CoinVisualState {
  if (coin.rawState === 'wait_candidate') return 'wait';
  if (coin.rawState === 'blocked_candidate') return 'blocked_push_out';
  if (coin.rawState === 'open_position') return 'open_position';
  if (coin.rawState === 'cooldown') return 'cooldown';
  if (coin.rawState === 'buy_candidate') return coin.isSelectedBuy ? 'buy_pull_to_core' : 'buy_ready';
  if (coin.rawState === 'scanning') return 'scanning';
  return 'neutral';
}

export function getVisualStateLabel(state: CoinVisualState): string {
  switch (state) {
    case 'buy_pull_to_core':
      return 'BUY / Transfer to Open Positions';
    case 'blocked_push_out':
      return 'Blocked / Pushed Out';
    case 'open_position':
      return 'Open Position';
    case 'buy_ready':
      return 'Buy Ready';
    default:
      return state.charAt(0).toUpperCase() + state.slice(1);
  }
}
