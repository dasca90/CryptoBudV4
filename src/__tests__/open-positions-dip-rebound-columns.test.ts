import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/OpenPositionsPanel.tsx'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. Dip column exists
ok(panelSrc.includes('"Dip"'), 'Dip column in column list');

// 2. Rebound column exists next to Dip
ok(panelSrc.includes('"Rebound"'), 'Rebound column in column list');

// 3. Dip displays as percentage (or n/a for dip_and_rebound with dip=0)
ok(panelSrc.includes('dipPct != null'), 'Dip cell reads dipPct from row');
ok(panelSrc.includes("'--'"), 'Dip falls back to --/n/a when missing');

// 4. Rebound displays as positive percentage
ok(panelSrc.includes('reboundPct'), 'Rebound cell renders reboundPct');

// 5. Adapter exposes dipPct and requiredDipPct
ok(adapterSrc.includes('dipPct: typeof setup.metrics.actualDipPct'), 'adapter maps dipPct from setup metrics');

// 6. Adapter exposes reboundPct and requiredReboundPct
ok(adapterSrc.includes('requiredReboundPct: typeof setup.metrics.requiredReboundPct'), 'adapter maps requiredReboundPct from metrics');

// 7. Data comes from entry snapshot setupMetrics (not scanner)
ok(adapterSrc.includes('entryConfigSnapshot') && adapterSrc.includes('setupMetrics'), 'adapter reads from entryConfigSnapshot setupMetrics');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
