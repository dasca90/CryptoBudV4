import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const src = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');

ok(src.includes('TOP_CANDIDATE_DISPLAY_AUDIT'), '1 display audit exists');
ok(src.includes('TOP_CANDIDATE_STATUS_REASON_AUDIT'), '2 status reason audit exists');
ok(src.includes('TOP_CANDIDATE_BUY_READY_NOT_EXECUTED_AUDIT'), '3 buy-ready-not-executed audit exists');
ok(src.includes('Symbol</span>') && src.includes('Trend</span>') && src.includes('Strategy</span>') && src.includes('Conf</span>') && src.includes('Dip</span>') && src.includes('Reb</span>') && src.includes('Mom</span>') && src.includes('Status</span>') && src.includes('Why</span>'), '4 compact primary columns include Symbol/Trend/Strategy/Conf/Dip/Reb/Mom/Status/Why');
ok(src.includes('Market setup:') && src.includes('Runtime mode:') && src.includes('Final strategy:') && src.includes('formatStrategyLabel(marketSetup)') && src.includes(' -> ${formatStrategyLabel(finalStrategy)}'), '4b strategy column separates market setup/runtime/final strategy');
ok(src.includes('SPREAD_TOO_HIGH') && src.includes('TP_ROOM_MISSING') && src.includes('PRICE_NOT_FRESH') && src.includes('MAX_POSITIONS_REACHED') && src.includes('ENTRY_GATE_BLOCKED') && src.includes('EXECUTION_NOT_TRIGGERED') && src.includes('BUY_READY') && src.includes('CANDLE_EXHAUSTION') && src.includes('OVEREXTENDED') && src.includes('TP1_INVALID'), '5 WHY canonical labels present');
ok(src.includes("viewMode === 'compact'") && src.includes("viewMode === 'detailed'"), '6 compact/detailed modes still exist');
ok(src.includes('setSourceFilter') && src.includes('<select value={sourceFilter}'), '7 filter dropdown still wired');
ok(src.includes('onClick={() => props.onSelectSymbol(c.symbol)}'), '8 candidate row selection still works');

console.log(`top-candidates-compact-why-audit: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
