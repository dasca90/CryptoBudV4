import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const appSrc = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const engineSrc = readFileSync(join(process.cwd(), 'src', 'core', 'trading', 'TradingEngine.ts'), 'utf8');

ok(engineSrc.includes('setEventCallbacks('), 'A engine exposes event callback registration');
ok(engineSrc.includes('onTradeOpened?.(tradeRecord)'), 'B engine emits opened trade callback from canonical entry path');
ok(engineSrc.includes('onTradeClosed?.(fullTrade)'), 'C engine emits closed trade callback from canonical exit path');

ok(appSrc.includes("telegramNotifierRef.current.notify('BUY_OPENED'"), 'D app sends BUY_OPENED telegram notification');
ok(appSrc.includes('engine.setEventCallbacks({'), 'E app wires trading engine callbacks');
ok(appSrc.includes('TELEGRAM_BUY_NOTIFY_'), 'F app logs buy telegram send status');

console.log(`telegram-buy-runtime-wiring: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
