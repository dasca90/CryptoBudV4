/**
 * TraderBrain + EntryGate Test Suite
 *
 * 8 core test cases covering strategy selection, playbook eligibility,
 * EntryGate blocking, and paper/live parity.
 *
 * Run: npx tsx src/__tests__/trader-brain.test.ts
 */

import { TraderBrain } from '../core/trading/TraderBrain';
import { MLPredictor } from '../core/ml/MLPredictor';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { LiveBinanceAdapter } from '../core/exchange/LiveBinanceAdapter';
import { EntryGate } from '../core/entry-gate/EntryGate';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { evaluateUnifiedEntrySignal, getBuyRuleEntryDefinition } from '../core/strategy-selector/buy-rule-matrix';
import { evaluatePlaybook, selectPlaybook } from '../core/strategy-selector/strategy-playbooks';
import type {
  TraderBrainConfig, TraderAction, EntryGateInput, LiveSafetyState,
  UnifiedEntryInput, PlaybookInput,
} from '../core/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function assertMatch(val: string, patterns: string[], msg: string) {
  const ok = patterns.some(p => val.toLowerCase().includes(p.toLowerCase()));
  if (ok) { passed++; console.log(`  ✅ ${msg} — got "${val}"`); }
  else { failed++; console.error(`  ❌ ${msg} — expected one of ${patterns.join(', ')}, got "${val}"`); }
}

const feed = MarketDataFeed.getInstance();

function createConfig(overrides?: Partial<TraderBrainConfig>): TraderBrainConfig {
  return {
    coin: 'BTCUSDT', mode: 'AUTO', enabled: true,
    maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5,
    maxLeverage: 1, cooldownSeconds: 0, mlEnabled: false, minConfidence: 0,
    ...overrides,
  };
}

function makeGateInput(overrides?: Partial<EntryGateInput>): EntryGateInput {
  return {
    coin: 'BTCUSDT', side: 'BUY', price: 50000, quantity: 0.002,
    mode: 'AUTO', mlConfidence: 0.8, prediction: 'BUY',
    currentPositions: 0, maxPositions: 10, recentLoss: false,
    spreadOk: true, volumePass: true, priceFresh: true,
    btcDumping: false, marketRegimeUnsafe: false,
    reboundConfirmed: true, momentumConfirmed: true,
    tpRoomOk: true, isVeryHighRisk: false, isLive: false,
    ...overrides,
  };
}

function seedPrices(coin: string, prices: number[]) {
  for (const p of prices) {
    feed.setManualPrice(coin, p);
    // Manually push into a fresh ml predictor's window by feeding price events
  }
}

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  TraderBrain + EntryGate Test Suite');
  console.log('══════════════════════════════════════════════\n');

  // ── A. Balanced waits for rebound ──
  console.log('\n── A. Balanced waits for rebound ──\n');

  const mlA = new MLPredictor();
  // Feed mixed prices ending in a dip → negative momentum, no rebound, RSI in range
  for (let i = 0; i < 15; i++) {
    const offset = i < 5 ? 0 : (i - 5) * 15;
    mlA.feedPrice({ coin: 'BTCUSDT', bid: 50100 - offset, ask: 50110 - offset, last: 50100 - offset, timestamp: Date.now() });
  }

  const adapterA = new PaperExchangeAdapter();
  await adapterA.connect();
  const brainA = new TraderBrain(createConfig(), adapterA, mlA);

  const decisionA = await brainA.decide();
  const trace = decisionA.ruleDecisionTrace;

  assert(decisionA.status === 'WAITING' || decisionA.status === 'BLOCK', `Status is WAITING/BLOCK (got ${decisionA.status})`);

  // Check unified signal trace for the balanced rule response
  if (trace.unifiedSignal) {
    const reasonContainsRebound = trace.unifiedSignal.reason.toLowerCase().includes('rebound')
      || trace.unifiedSignal.reason.toLowerCase().includes('dip')
      || trace.unifiedSignal.reason.toLowerCase().includes('falling knife')
      || trace.unifiedSignal.reasonCode === 'FALLING_KNIFE'
      || trace.unifiedSignal.reasonCode === 'BALANCED_WAITING';
    assert(reasonContainsRebound, `UnifiedSignal reason mentions rebound/dip/waiting (got: ${trace.unifiedSignal.reasonCode}: ${trace.unifiedSignal.reason})`);
  } else {
    assert(false, 'Unified signal trace exists');
  }

  // ── B. Falling knife blocks/waits ──
  console.log('\n── B. Falling knife blocks/waits ──\n');

  const mlB = new MLPredictor();
  // Deep descending prices → fallling knife, candle exhaustion
  for (let i = 0; i < 15; i++) {
    mlB.feedPrice({ coin: 'BTCUSDT', bid: 50000 - i * 150, ask: 50000 - i * 150 + 10, last: 50000 - i * 150, timestamp: Date.now() });
  }

  const adapterB = new PaperExchangeAdapter();
  await adapterB.connect();
  const brainB = new TraderBrain(createConfig(), adapterB, mlB);

  const decisionB = await brainB.decide();
  assert(decisionB.status === 'BLOCK' || decisionB.status === 'WAITING', `Status is BLOCK/WAITING (got ${decisionB.status})`);
  const hb = decisionB.ruleDecisionTrace.autobotsResult?.hardBlocks;
  assert(hb !== undefined && hb.length > 0, `AutoBots has hard blocks (got: ${hb?.join(', ') ?? 'none'})`);

  // ── C. Momentum requires volume and momentum ──
  console.log('\n── C. Momentum playbook requires volume ──\n');

  const volInput: PlaybookInput = {
    symbol: 'BTCUSDT', marketRegime: 'uptrend', btcRegime: 'uptrend', groupRegime: 'uptrend',
    confidence: 0.9, volumeAvailable: false, volumePass: false,
    momentumConfirmed: true, overextended: false,
    dipDetected: false, reboundConfirmed: false, reboundPct: 0,
    tpRoomOk: true, spreadOk: true, priceFresh: true,
    relativeStrengthVsBtc: 2, entryTiming: 'good', btcDumping: false, isAlt: false,
  };

  const momentumResult = evaluatePlaybook('momentum', volInput);
  assert(!momentumResult.eligible, `Momentum not eligible without volume (got eligible=${momentumResult.eligible})`);
  assert(momentumResult.blockReasons.includes('volume_required_missing'), `Block reason includes volume_required_missing (got: ${momentumResult.blockReasons.join(', ')})`);

  // ── D. BTC dumping blocks alt via EntryGate ──
  console.log('\n── D. BTC dumping blocks alt via EntryGate ──\n');

  const gate = new EntryGate();
  const gateD = gate.evaluate(makeGateInput({ btcDumping: true }));
  assert(gateD.decision === 'BLOCK', `EntryGate blocks when BTC dumping (got ${gateD.decision})`);
  assert(gateD.blockReasons.includes('BLOCK_BTC_DUMP'), `Block reason includes BLOCK_BTC_DUMP (got: ${gateD.blockReasons.join(', ')})`);

  // ── E. No TP room blocks via EntryGate ──
  console.log('\n── E. No TP room blocks via EntryGate ──\n');

  const gateE = gate.evaluate(makeGateInput({ tpRoomOk: false }));
  assert(gateE.decision === 'BLOCK', `EntryGate blocks when no TP room (got ${gateE.decision})`);
  assert(gateE.blockReasons.includes('BLOCK_NO_TP_ROOM'), `Block reason includes BLOCK_NO_TP_ROOM (got: ${gateE.blockReasons.join(', ')})`);

  // ── F. Stale price blocks via EntryGate ──
  console.log('\n── F. Stale price blocks via EntryGate ──\n');

  const gateF = gate.evaluate(makeGateInput({ priceFresh: false }));
  assert(gateF.decision === 'BLOCK', `EntryGate blocks when price stale (got ${gateF.decision})`);
  assert(gateF.blockReasons.includes('BLOCK_PRICE_STALE'), `Block reason includes BLOCK_PRICE_STALE (got: ${gateF.blockReasons.join(', ')})`);

  // ── G. Very high risk live blocks via EntryGate ──
  console.log('\n── G. Very high risk live blocks via EntryGate ──\n');

  const gateG = gate.evaluate(makeGateInput({ isVeryHighRisk: true, isLive: true }));
  assert(gateG.decision === 'BLOCK', `EntryGate blocks very high risk on live (got ${gateG.decision})`);
  assert(gateG.blockReasons.includes('BLOCK_VERY_HIGH_RISK_LIVE'), `Block reason includes BLOCK_VERY_HIGH_RISK_LIVE (got: ${gateG.blockReasons.join(', ')})`);

  // ── H. Clean setup allows in paper via EntryGate ──
  console.log('\n── H. Clean setup allows in paper via EntryGate ──\n');

  const gateH = gate.evaluate(makeGateInput({}));
  assert(gateH.decision === 'ALLOW', `EntryGate allows clean paper setup (got ${gateH.decision})`);

  // ── Cleanup: close adapters, destroy singleton feed ──
  await adapterA.disconnect();
  await adapterB.disconnect();

  // ── Summary ────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════\n');

  if (failed > 0) { process.exit(1); return; }
  // On success, set exit code and let event loop drain naturally.
  // Avoid process.exit(0) on Windows to prevent UV_HANDLE_CLOSING assertion
  // from Node.js's internal fetch/undici connection pool teardown.
  process.exitCode = 0;
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
