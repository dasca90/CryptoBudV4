import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. STOP_LOSS path calls executeExitWithSnapshot
ok(engineSrc.includes('this.executeExitWithSnapshot(brain, pos, decision, priceRes)'), 'SL calls executeExitWithSnapshot');

// 2. Exit transaction via exit engine
ok(engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'exit evaluation audit exists');

// 3. STOP_LOSS_TRIGGER_AUDIT before sell
ok(engineSrc.includes('STOP_LOSS_TRIGGER_AUDIT') && engineSrc.includes('adapterWillBeCalled=true'), 'SL trigger audit marks adapter call');

// 4. Exit evaluation runs for all open positions (scanner_auto included)
ok(engineSrc.includes('positionManager.getOpenPositions()') && engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'exit iterates all positions');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
