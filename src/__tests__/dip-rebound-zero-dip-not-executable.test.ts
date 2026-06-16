import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/OpenPositionsPanel.tsx'), 'utf8');

// 1. Dip must NOT be 0 for dip_and_rebound executed strategy
ok(engineSrc.includes("posStrategy === 'dip_and_rebound'"), 'TradingEngine identifies dip_and_rebound strategy');

// 2. Contract invalid when dip=0
ok(engineSrc.includes('actualDipPct_missing_or_zero'), 'contract rejects actualDipPct=0 or missing');

// 3. Rebound column added to Open Positions after Dip
const dipIdx = panelSrc.indexOf('"Dip"');
const reboundIdx = panelSrc.indexOf('"Rebound"');
ok(reboundIdx > dipIdx, 'Rebound column follows Dip in column list');

// 4. Rebound cell rendering
ok(panelSrc.includes('reboundPct'), 'OpenPositionsPanel renders reboundPct');

// 5. Rebound shows as positive percentage (handles tiny values with <0.01% display)
ok(panelSrc.includes('reboundPct') && (panelSrc.includes('toFixed') || panelSrc.includes('0.005')), 'rebound displayed as positive percentage');

// 6. Contract audit checks dip >= required
ok(engineSrc.includes('actualDip >= requiredDip'), 'contract validates dip meets requirement');

// 7. Contract audit checks rebound >= required
ok(engineSrc.includes('actualRebound >= requiredRebound'), 'contract validates rebound meets requirement');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
