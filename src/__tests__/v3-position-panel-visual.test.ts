import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const css = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');
const open = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
const closed = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');

ok(css.includes('.v3-positions-window') && css.includes('background: #0b0b14'), '1 V3 position panel dark flat shell exists');
ok(css.includes('.v3-scrollbar-strip') && css.includes('top: 11px'), '2 V3 top scrollbar strip and sticky header offset exist');
ok(css.includes('font-family: "Consolas"') && css.includes('font-size: 10px'), '3 V3 compact monospace table density exists');
ok(css.includes('color: #bc83d8') && css.includes('color: #1fe4dd'), '4 V3 purple/cyan table palette exists');
ok(open.includes('Open Positions') && open.includes('v3-position-controls') && open.includes('Sort: Open time') && open.includes('All owners'), '5 Open panel header controls match V3');
ok(closed.includes('Sold Positions') && closed.includes('v3-sold-summary') && closed.includes('Realized Gross') && closed.includes('Fees Paid') && closed.includes('Realized Net') && closed.includes('Win Rate'), '6 Sold panel header summary matches V3 fee accounting');
ok(!open.includes('<th>Setup Result</th>') && !open.includes('<th>Why</th>'), '7 Open default does not render debug table headers directly');
ok(!closed.includes('<th>TP1 Target</th>') && !closed.includes('<th>TP1 Source</th>'), '8 Closed default does not render TP debug table headers directly');

console.log(`v3-position-panel-visual: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
