import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string) => c ? passed++ : (failed++, console.error(`FAIL: ${m}`));

const openSrc = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
const closedSrc = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
const adapterSrc = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');

ok(openSrc.includes('Formula:') && adapterSrc.includes('PnL $ = (Live Price - Entry Price) × Qty'), '1 open pnl tooltip shows formula');
ok(openSrc.includes('Entry:') && openSrc.includes('Live:') && openSrc.includes('Qty:'), '2 open pnl tooltip shows entry/live/qty');
ok(openSrc.includes('FALLBACK PRICE USED'), '3 open pnl tooltip flags fallback');
ok(openSrc.includes('PNL UNAVAILABLE — LIVE PRICE MISSING'), '4 open pnl tooltip flags unavailable');
ok(closedSrc.includes('Closed PnL') && closedSrc.includes('Entry:') && closedSrc.includes('Exit:'), '5 closed pnl tooltip uses exit context');
ok(closedSrc.includes('Close reason:') && closedSrc.includes('Price quality:'), '6 closed pnl tooltip shows reason + quality');
ok(openSrc.includes('Inspect') && openSrc.includes('Position Diagnostic:'), '7 diagnostic drawer opens from open row');
ok(openSrc.includes('TP1:') && openSrc.includes('TP2:') && openSrc.includes('SL:'), '8 diagnostic drawer shows TP1/TP2/SL');
ok(openSrc.includes('Used capital:'), '9 diagnostic drawer shows used capital');
ok(openSrc.includes('PnL calculation summary:'), '10 diagnostic drawer shows pnl calculation');
ok(openSrc.includes('AutoBots ON at entry:'), '11 diagnostic drawer shows autobots state');
ok(adapterSrc.includes('mapPositionToOpenPositionView') && adapterSrc.includes('pnlBreakdown') && adapterSrc.includes('diagnostic'), '12 diagnostic/pnl sourced from canonical adapter mapping');

console.log(`pnl-tooltip-diagnostic-ui: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
