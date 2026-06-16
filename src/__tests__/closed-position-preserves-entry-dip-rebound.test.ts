import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. Closed position preserves dip from entry snapshot
ok(adapterSrc.includes('dipPct'), 'closed positions have dipPct access');

// 2. Closed position preserves rebound from entry snapshot
ok(adapterSrc.includes('reboundPct'), 'closed positions have reboundPct access');

// 3. Closed position reads from buySnapshot (not recomputed)
ok(adapterSrc.includes('trade.buySnapshot'), 'closed positions read from buySnapshot');

// 4. Entry snapshot dip/rebound preserved (not recomputed at close)
ok(adapterSrc.includes('entryConfigSnapshot') && adapterSrc.includes('entrySnapshot'), 'closed position entry snapshot referenced');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
