import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. EXIT_EVALUATION_AUDIT exists
ok(engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'TradingEngine emits exit evaluation audit');

// 2. All required fields
ok(engineSrc.includes('strategyAtEntry=${pos.buySnapshot?.selectedStrategy'), 'audit exposes strategyAtEntry');
ok(engineSrc.includes('stopLossPct=${pos.stopLossPercent}'), 'audit exposes stopLossPct');
ok(engineSrc.includes('stopTriggerPrice=${stopTriggerPrice'), 'audit exposes stopTriggerPrice');
ok(engineSrc.includes('shouldStopLossSell=${String(shouldStopLossSell)}'), 'audit exposes shouldStopLossSell');
ok(engineSrc.includes('shouldTakeProfitSell=${String(shouldTakeProfitSell)}'), 'audit exposes shouldTakeProfitSell');
ok(engineSrc.includes('finalExitDecision=${shouldStopLossSell'), 'audit exposes finalExitDecision');
ok(engineSrc.includes('noExitReason='), 'audit exposes noExitReason');
ok(engineSrc.includes('unrealizedPnlPct=${pnlPct.toFixed(2)}'), 'audit exposes unrealizedPnlPct');
ok(engineSrc.includes('tp1TriggerPrice=${(pos.avgEntryPrice * (1 + pos.tp1Percent / 100)).toFixed(4)}'), 'audit exposes tp1TriggerPrice');

// 3. STOP_LOSS_TRIGGER_AUDIT exists
ok(engineSrc.includes('STOP_LOSS_TRIGGER_AUDIT'), 'TradingEngine emits stop loss trigger audit');
ok(engineSrc.includes('triggerMethod=price'), 'SL audit exposes triggerMethod');
ok(engineSrc.includes('exitReason=STOP_LOSS_HIT'), 'SL audit exposes exitReason');
ok(engineSrc.includes('adapterWillBeCalled=true'), 'SL audit marks adapterWillBeCalled');

// 4. EXIT_ENGINE_LIFECYCLE_AUDIT exists
ok(engineSrc.includes('EXIT_ENGINE_LIFECYCLE_AUDIT'), 'TradingEngine emits exit engine lifecycle audit');

// 5. Exit loop iterates ALL PositionManager open positions (not just brains)
ok(engineSrc.includes('for (const pos of this.positionManager.getOpenPositions())') && engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'exit evaluation iterates all open positions');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
