import assert from 'node:assert/strict';
import { PositionManager } from '../core/positions/PositionManager';
import type { Position } from '../core/types';

function makePosition(symbol: string): Position {
  return {
    coin: symbol,
    mode: 'AUTO',
    quantity: 1,
    avgEntryPrice: 10,
    currentPrice: 10,
    unrealizedPnlPercent: 0,
    openedAt: Date.now(),
    highestPrice: 10,
    tradeId: `trade_${symbol}`,
  } as Position;
}

const pm = new PositionManager();
const events: Array<{ count: number; reason: string; symbol?: string }> = [];
const unsubscribe = pm.subscribe((positions, reason, symbol) => {
  events.push({ count: positions.length, reason, symbol });
});

pm.addPosition('OPUSDT', makePosition('OPUSDT'));
pm.updatePosition('OPUSDT', { currentPrice: 10.1 });
pm.removePosition('OPUSDT');
pm.restorePositions([makePosition('BIOUSDT'), makePosition('MUBUSDT')]);
unsubscribe();
pm.addPosition('NVDABUSDT', makePosition('NVDABUSDT'));

assert.deepEqual(
  events.map(e => `${e.reason}:${e.symbol ?? 'none'}:${e.count}`),
  ['initial:none:0', 'add:OPUSDT:1', 'update:OPUSDT:1', 'remove:OPUSDT:0', 'restore:none:2'],
);

console.log('position-manager-reactive-render: ok');
