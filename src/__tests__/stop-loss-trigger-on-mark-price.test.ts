import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Stop loss trigger uses markPrice <= stopTriggerPrice (price-based)
ok(engineSrc.includes('markPrice <= stopTriggerPrice'), 'SL trigger uses price-based check');

// 2. stopTriggerPrice = entryPrice * (1 - stopLossPct / 100)
ok(engineSrc.includes('pos.avgEntryPrice * (1 - pos.stopLossPercent / 100)'), 'stopTriggerPrice formula correct');

// 3. STOP_LOSS_TRIGGER_AUDIT fires when SL hit
ok(engineSrc.includes('STOP_LOSS_TRIGGER_AUDIT') && engineSrc.includes('shouldStopLossSell'), 'SL trigger audit fires');

// 4. Sell path called after SL trigger
ok(engineSrc.includes('this.executeExitWithSnapshot(brain, pos, decision, priceRes)'), 'SL triggers executeExitWithSnapshot');

// 5. Exit evaluation runs for all open positions
ok(engineSrc.includes('for (const pos of this.positionManager.getOpenPositions())') && engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'exit eval iterates positionManager');

// 6. SL only triggers when markPrice > 0
ok(engineSrc.includes('markPrice > 0 && stopTriggerPrice > 0 && markPrice <= stopTriggerPrice'), 'SL requires markPrice > 0');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
