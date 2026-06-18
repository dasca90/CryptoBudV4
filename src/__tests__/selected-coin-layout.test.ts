import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const selected = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
const css = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');
const tradeV4 = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');

ok(selected.includes('SELECTED_COIN_CARD_LAYOUT_AUDIT'), '1 layout audit log exists');
ok(selected.includes('selected-coin-card') && selected.includes('selected-coin-content'), '2 selected coin uses dedicated container + content wrappers');
ok(selected.includes('setShowRawAudit') && selected.includes('Raw Audit') && selected.includes('Hide Raw'), '3 raw audit toggle exists');
ok(selected.includes('onManualBuy(c.symbol)'), '4 buy button remains visible/actionable');
ok(selected.includes('Final Decision') && selected.includes('Entry Gate') && selected.includes('Smart / Professional Analysis') && selected.includes('TP / Risk'), '5 readable sections remain visible in source');
ok(selected.includes('overflowDetected=') && selected.includes('containerWidth=') && selected.includes('contentWidth='), '6 audit includes overflow and dimensions');
ok(css.includes('.selected-coin-card') && css.includes('.selected-coin-content') && css.includes('overflow-y: auto'), '7 internal scroll styling exists');
ok(tradeV4.includes('panel-shell-selected') && tradeV4.includes('<TopCandidatesPanel'), '8 right sidebar selected/top layout remains mounted');

console.log(`selected-coin-layout: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
