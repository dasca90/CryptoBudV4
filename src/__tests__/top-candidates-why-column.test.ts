import { readFileSync } from 'node:fs';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const src = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');

ok(src.includes('>Why</span>'), '1 WHY column header renders');
ok(src.includes('compactGridCols =') && src.includes("visibleColumns = viewMode === 'compact'") && src.includes('confidence_score|dip|rebound|momentum|status|why'), '2 WHY column is visible in compact/default view with new compact order');
ok(src.includes('SPREAD_TOO_HIGH'), '3 WHY includes SPREAD_TOO_HIGH');
ok(src.includes('WAITING_FOR_DIP'), '4 WHY includes WAITING_FOR_DIP');
ok(src.includes('WAITING_FOR_REBOUND'), '5 WHY includes WAITING_FOR_REBOUND');
ok(src.includes('BUY_READY'), '6 WHY includes BUY_READY');
ok(src.includes('TP_ROOM_MISSING') && src.includes('PRICE_NOT_FRESH') && src.includes('ENTRY_GATE_BLOCKED') && src.includes('EXECUTION_NOT_TRIGGERED'), '7 WHY includes canonical blocker badges');
ok(src.includes('UNKNOWN_LEGACY'), '8 WHY includes UNKNOWN_LEGACY fallback');

const selectedSrc = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
ok(selectedSrc.includes('Intended') && selectedSrc.includes('Final') && selectedSrc.includes('Actual dip/rebound:'), '9 Selected Coin shows intended/final/actual dynamic fields');

console.log(`top-candidates-why-column: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
