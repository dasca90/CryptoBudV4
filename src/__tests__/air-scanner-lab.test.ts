import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { getBlockedPushFrame, acquireBuyLightningLock, releaseBuyLightningLock, resetAnimationLocksForTests } from '../features/air-scanner-lab/utils/animationTimelines';
import { mapMockCoinToVisualState } from '../features/air-scanner-lab/utils/visualStateMapper';

assert.equal(mapMockCoinToVisualState({ rawState: 'scanning' }), 'scanning');
assert.equal(mapMockCoinToVisualState({ rawState: 'wait_candidate' }), 'wait');
assert.equal(mapMockCoinToVisualState({ rawState: 'buy_candidate', isSelectedBuy: true }), 'buy_pull_to_core');
assert.equal(mapMockCoinToVisualState({ rawState: 'blocked_candidate' }), 'blocked_push_out');

resetAnimationLocksForTests();
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), false);
releaseBuyLightningLock('UNIUSDT', 'cycle-1');
assert.equal(acquireBuyLightningLock('UNIUSDT', 'cycle-1'), true);

const blockedStart: [number, number, number] = [3.45, 1.9, 0.25];
const blockedFrame = getBlockedPushFrame(blockedStart, 9_000);
assert.ok(Math.hypot(blockedFrame.position[0], blockedFrame.position[2]) > Math.hypot(blockedStart[0], blockedStart[2]));
assert.ok(blockedFrame.opacity < 1);

const featureRoot = join(process.cwd(), 'src', 'features', 'air-scanner-lab');
const forbiddenImports = [
  'core/trading',
  'TradingEngine',
  'LiveBinanceAdapter',
  'PaperExchangeAdapter',
  'MarketScanner',
  'AutoRuntime',
  'ExecutionPlanner',
  'RiskEngine',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

for (const file of walk(featureRoot)) {
  const contents = readFileSync(file, 'utf8');
  for (const forbidden of forbiddenImports) {
    assert.equal(contents.includes(forbidden), false, `${file} imports or references ${forbidden}`);
  }
}

console.log('air-scanner-lab tests passed');
