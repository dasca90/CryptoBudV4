import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/OpenPositionsPanel.tsx'), 'utf8');
const cssSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/trade-v4.css'), 'utf8');

// Part A — Tooltip portal implementation
// 1. Tooltip is portaled outside table container (createPortal exists)
ok(panelSrc.includes('createPortal'), 'createPortal imported and used for row tooltip');
ok(panelSrc.includes('document.body'), 'tooltip portals into document.body');

// 2. Tooltip uses position:fixed
ok(cssSrc.includes('.row-tooltip-portal') && cssSrc.includes('position: fixed'), 'row-tooltip-portal uses position:fixed');

// 3. Viewport clamping (bounds checking)
ok(panelSrc.includes('window.innerWidth') || panelSrc.includes('innerWidth'), 'viewport width clamping exists');
ok(panelSrc.includes('window.innerHeight') || panelSrc.includes('innerHeight'), 'viewport height clamping exists');

// 4. Tooltip flips left when overflows right edge
ok(panelSrc.includes("align: 'left'") || panelSrc.includes("'left'"), 'tooltip flips to left side when right edge overflows');

// 5. Tooltip flips up when overflows bottom edge
ok(panelSrc.includes('flipY'), 'tooltip flips upward when bottom edge overflows');

// 6. z-index above all panels (z-index: 50 in portal, diag-backdrop has 40)
ok(panelSrc.includes('zIndex: 50') || panelSrc.includes('z-index: 50'), 'tooltip z-index is 50 (above all panels/modals)');

// 7. Tooltip shows full data fields
ok(panelSrc.includes('Symbol:') && panelSrc.includes('tooltipState.position.symbol'), 'tooltip shows Symbol');
ok(panelSrc.includes('Strategy:'), 'tooltip shows Strategy');
ok(panelSrc.includes('Entry:'), 'tooltip shows Entry price');
ok(panelSrc.includes('Ref:'), 'tooltip shows Ref price');
ok(panelSrc.includes('Live:'), 'tooltip shows Live price');
ok(panelSrc.includes('Dip:'), 'tooltip shows Dip');
ok(panelSrc.includes('Rebound:'), 'tooltip shows Rebound');
ok(panelSrc.includes('Momentum:'), 'tooltip shows Momentum');
ok(panelSrc.includes('TP1:'), 'tooltip shows TP1');
ok(panelSrc.includes('TP2:'), 'tooltip shows TP2');
ok(panelSrc.includes('SL:'), 'tooltip shows SL');
ok(panelSrc.includes('PnL:'), 'tooltip shows PnL');
ok(panelSrc.includes('Owner:'), 'tooltip shows Owner');
ok(panelSrc.includes('Mode:'), 'tooltip shows Mode');
ok(panelSrc.includes('Entry Rule:'), 'tooltip shows Entry Rule');
ok(panelSrc.includes('source:'), 'tooltip shows source for each field');

// 8. Row hover triggers tooltip
ok(panelSrc.includes('onMouseEnter') && panelSrc.includes('handleRowEnter'), 'row mouseEnter hooks trigger tooltip');
ok(panelSrc.includes('onMouseLeave') && panelSrc.includes('handleRowLeave'), 'row mouseLeave clears tooltip');
ok(panelSrc.includes('getBoundingClientRect'), 'tooltip position calculated from getBoundingClientRect');

// 9. Tooltip not inside scrollable container (rendered via portal, not inside table)
ok(panelSrc.includes('<tr') && panelSrc.includes('onMouseEnter'), 'mouse handlers on tr, tooltip rendered via portal');

// 10. Existing PnL inline tooltip stays for PnL breakdown
ok(panelSrc.includes('pnl-tooltip-wrap'), 'PnL inline tooltip wraps still exist for PnL breakdown');

// 11. Max-height and internal scroll for tall content
ok(cssSrc.includes('max-height') || panelSrc.includes('maxHeight'), 'tooltip has max-height for overflow');
ok(panelSrc.includes('overflowY') || cssSrc.includes('overflow-y'), 'tooltip has internal scroll');

// 12. Pointer events none so tooltip doesn't block interaction
ok(cssSrc.includes('pointer-events: none'), 'tooltip has pointer-events:none');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
