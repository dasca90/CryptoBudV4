import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// 1. Recently closed symbol cooldown infrastructure exists
ok(scannerSrc.includes('recentlyClosedCooldownMs'), 'MarketScanner has recentlyClosedCooldownMs config');
ok(scannerSrc.includes('recentlyClosedSymbols'), 'MarketScanner has recentlyClosedSymbols map');

// 2. recordClose method exists and logs RECENTLY_CLOSED_SYMBOL_RECORDED
ok(scannerSrc.includes('recordClose(data:'), 'MarketScanner has recordClose method');
ok(scannerSrc.includes('RECENTLY_CLOSED_SYMBOL_RECORDED'), 'recordClose emits recorded audit');

// 3. Cooldown check blocks candidates in finalExecutionPool filter
ok(scannerSrc.includes('RECENTLY_CLOSED_SYMBOL_BLOCKED'), 'MarketScanner emits RECENTLY_CLOSED_SYMBOL_BLOCKED');
ok(scannerSrc.includes('candidateWouldOtherwiseBuy=true'), 'blocked audit notes candidate would otherwise buy');

// 4. Cooldown fields logged: symbol, closedAt, cooldownUntil, remainingMs, previousPnlPct, previousExitReason
ok(scannerSrc.includes('previousPnlPct=${cd.pnlPct.toFixed(2)}'), 'blocked audit exposes previousPnlPct');
ok(scannerSrc.includes('previousPnlUsd=${cd.pnlUsd.toFixed(2)}'), 'blocked audit exposes previousPnlUsd');
ok(scannerSrc.includes('previousExitReason=${cd.exitReason}'), 'blocked audit exposes previousExitReason');
ok(scannerSrc.includes('previousStrategy=${cd.strategy}'), 'blocked audit exposes previousStrategy');
ok(scannerSrc.includes('remainingMs=${remainingMs}'), 'blocked audit exposes remainingMs');

// 5. Cooldown summary log exists
ok(scannerSrc.includes('RECENTLY_CLOSED_SYMBOL_COOLDOWN_SUMMARY'), 'scanner emits cooldown summary');
ok(scannerSrc.includes('cooldownBlocked=${cooldownBlockedCount}'), 'post-router update includes cooldownBlocked count');

// 6. App.tsx wires recordClose from onTradeClosed
ok(appSrc.includes("engine.getAutoRuntime()?.getScanner()?.recordClose("), 'App.tsx calls recordClose from onTradeClosed callback');
ok(appSrc.includes('pnlPct: trade.pnlPercent'), 'App passes pnlPct to recordClose');
ok(appSrc.includes('pnlUsd: trade.pnl'), 'App passes pnlUsd to recordClose');
ok(appSrc.includes('exitReason: reason'), 'App passes exitReason to recordClose');

// 7. Prune expired cooldowns before filtering
ok(scannerSrc.includes('this.recentlyClosedSymbols.delete(sym)'), 'scanner prunes expired cooldowns');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
