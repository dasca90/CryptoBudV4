import { evaluateUnifiedEntrySignal } from '../core/strategy-selector/buy-rule-matrix';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

function baseInput(overrides: any = {}) {
  return {
    buyRule: 'balanced',
    dipDetected: true,
    dipPercent: -2.2,
    reboundConfirmed: true,
    reboundPct: 1.2,
    momentum: 0.3,
    momentumConfirmed: true,
    isUptrend: true,
    isDowntrend: false,
    isChoppy: false,
    isSideways: false,
    volumeHigh: true,
    priceFresh: true,
    btcDumping: false,
    ...overrides,
  } as const;
}

function main() {
  const momNoRebound = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'momentum', reboundConfirmed: false } as any));
  ok(momNoRebound.signal === 'WAITING' && momNoRebound.reasonCode === 'WAITING_FOR_SETUP', '1 momentum requires rebound confirmation');

  const drWeakDip = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'dip_and_rebound', dipPercent: -0.6, reboundPct: 0.5 } as any));
  ok(drWeakDip.signal === 'WAITING', '2 dip_and_rebound blocks dip below 0.8%');

  const drWeakRebound = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'dip_and_rebound', dipPercent: -1.0, reboundPct: 0.2 } as any));
  ok(drWeakRebound.signal === 'WAITING', '3 dip_and_rebound blocks rebound below 0.4%');

  const drPass = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'dip_and_rebound', dipPercent: -1.0, reboundPct: 0.5 } as any));
  ok(drPass.signal === 'BUY', '4 dip_and_rebound passes with dip>=0.8 and rebound>=0.4');

  const consWeakDip = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'conservative', dipPercent: -1.2, reboundPct: 1.1 } as any));
  ok(consWeakDip.signal === 'WAITING', '5 conservative blocks dip below 2.0%');

  const consWeakRebound = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'conservative', dipPercent: -2.2, reboundPct: 0.6 } as any));
  ok(consWeakRebound.signal === 'WAITING', '6 conservative blocks rebound below 1.0%');

  const consPass = evaluateUnifiedEntrySignal(baseInput({ buyRule: 'conservative', dipPercent: -2.2, reboundPct: 1.2 } as any));
  ok(consPass.signal === 'BUY', '7 conservative passes with dip>=2.0 and rebound>=1.0');

  console.log(`strategy-setup-rules: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
}

main();
