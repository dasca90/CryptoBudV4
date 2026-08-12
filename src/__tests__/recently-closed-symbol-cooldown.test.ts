import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// 1. Recently closed symbol cooldown infrastructure exists
ok(scannerSrc.includes('recentlyClosedCooldownMs'), 'MarketScanner has recentlyClosedCooldownMs config');
ok(scannerSrc.includes('recentlyClosedSymbols'), 'MarketScanner has recentlyClosedSymbols map');

// 2. recordClose method exists and logs RECENTLY_CLOSED_SYMBOL_RECORDED
ok(scannerSrc.includes('recordClose(data:'), 'MarketScanner has recordClose method');
ok(scannerSrc.includes('RECENTLY_CLOSED_SYMBOL_RECORDED'), 'recordClose emits recorded audit');

// 3. Canonical symbol eligibility blocks before ranking/queue selection
ok(plannerSrc.includes('evaluateSymbolExecutionEligibility'), 'ExecutionPlanner owns canonical symbol eligibility');
ok(plannerSrc.includes('SYMBOL_REENTRY_ELIGIBILITY_AUDIT'), 'planner emits explicit re-entry audit');

// 4. Cooldown fields logged: symbol, closedAt, cooldownUntil, remainingMs, previousPnlPct, previousExitReason
ok(plannerSrc.includes('previousPnl=${reentryState?.pnlPct'), 'eligibility audit exposes previous PnL');
ok(plannerSrc.includes('previousCloseReason=${reentryState?.exitReason'), 'eligibility audit exposes close reason');
ok(plannerSrc.includes('cooldownRemainingMs=${eligibility.cooldownRemainingMs}'), 'eligibility audit exposes remaining time');

// 5. Cooldown summary log exists
ok(plannerSrc.includes('EXECUTION_QUEUE_ELIGIBILITY_AUDIT'), 'planner emits cooldown/recovery queue summary');
ok(plannerSrc.includes('symbolCooldownBlockedCount'), 'queue summary includes cooldown count');

// 6. App.tsx wires recordClose from onTradeClosed
ok(appSrc.includes("engine.getAutoRuntime()?.getScanner()?.recordClose("), 'App.tsx calls recordClose from onTradeClosed callback');
ok(appSrc.includes('pnlPct: trade.pnlPercent'), 'App passes pnlPct to recordClose');
ok(appSrc.includes('pnlUsd: trade.pnl'), 'App passes pnlUsd to recordClose');
ok(appSrc.includes('exitReason: reason'), 'App passes exitReason to recordClose');

// 7. Prune expired cooldowns before filtering
ok(scannerSrc.includes('this.recentlyClosedSymbols.delete(sym)'), 'scanner prunes expired cooldowns');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
