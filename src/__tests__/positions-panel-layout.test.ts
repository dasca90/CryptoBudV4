import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const pageSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/TradeV4Page.tsx'), 'utf8');
const cssSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/trade-v4.css'), 'utf8');

// Test B1: Layout uses flex column for right positions column
ok(pageSrc.includes("flexDirection: 'column'") && pageSrc.includes("open-positions-workspace"), 'Test B1: Right columns use flexDirection column for positions stacking');

// Test B2: Open and Closed both use flex:1 to fill space equally
ok(pageSrc.includes("flex: '1 1 0'"), 'Test B2: Position panels use flex 1 1 0 to fill space');

// Test B3: Min-height 0 on flex parents
ok(pageSrc.includes('minHeight: 0'), 'Test B3: min-height:0 present on flex containers');

// Test B4: Gap between Open and Closed panels
ok(pageSrc.includes('gap: 8') || pageSrc.includes('gap:8'), 'Test B4: Small gap between Open and Closed panels');

// Test B5: CSS first-child min-height changed to 0
ok(cssSrc.includes('.open-v4 > :first-child') && cssSrc.includes('min-height: 0'), 'Test B5: CSS position panels first-child uses min-height:0');

// Test B6: CSS first-child uses flex:1
ok(cssSrc.includes('flex: 1') && cssSrc.includes('.open-v4 > :first-child'), 'Test B6: Position panel child uses flex:1');

// Test B7: Vertical scroll class exists for table body
ok(cssSrc.includes('overflow-y: auto') || cssSrc.includes('overflow: auto !important'), 'Test B7: Table scroll area has overflow-y:auto or overflow:auto');

// Test B8: POSITIONS_PANEL_LAYOUT_AUDIT exists
ok(pageSrc.includes('POSITIONS_PANEL_LAYOUT_AUDIT'), 'Test B8: POSITIONS_PANEL_LAYOUT_AUDIT log exists');

// Test B9: Layout audit logs viewport and panel heights
ok(pageSrc.includes('openPanelHeight') && pageSrc.includes('closedPanelHeight'), 'Test B9: Layout audit logs Open and Closed panel heights');

// Test B10: Layout audit logs scroll state
ok(pageSrc.includes('openCanScrollVertical') && pageSrc.includes('closedCanScrollVertical'), 'Test B10: Layout audit logs scroll capability');

// Test B11: Closed positions uses proper scroll containers
ok(pageSrc.includes('ClosedPositionsPanel') || pageSrc.includes('closed-positions'), 'Test B11: ClosedPositionsPanel rendered in layout');

// Test B12: No large fixed min-heights blocking flex
ok(cssSrc.includes('.open-v4') && cssSrc.includes('.closed-v4') && cssSrc.includes('min-height: 0'), 'Test B12: CSS open-v4/closed-v4 have min-height:0');

// Test B13: Header stays sticky above table
ok(cssSrc.includes('position: sticky') && cssSrc.includes('.data-table thead th'), 'Test B13: Table headers stay sticky');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
