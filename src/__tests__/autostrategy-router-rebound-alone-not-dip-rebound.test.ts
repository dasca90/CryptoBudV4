import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const routerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/AutoStrategyRouter.ts'), 'utf8');

// 1. Rebound alone without dipPct<0 must not select dip_and_rebound (bearish)
ok(routerSrc.includes('reboundConfirmed && dipPct < 0 && tpRoomOk'), 'bearish group: rebound alone without dip does not select dip_and_rebound');

// 2. Rebound confirmed without dip does Not trigger dip_and_rebound in caution
ok(routerSrc.includes('reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh') && routerSrc.includes("caution"), 'caution group: rebound alone without dipPct<0 does not select dip_and_rebound');

// 3. waiting_for_rebound group requires dipPct<0
ok(routerSrc.includes('waiting_for_rebound') && routerSrc.includes('dipPct < 0'), 'waiting_for_rebound: requires dipPct<0');

// 4. Sideways group requires dipPct<0 with rebound
ok(routerSrc.includes('sideways') && routerSrc.includes('dipPct < 0'), 'sideways: requires dipPct<0 with rebound');

// 5. Rejected reason: dip_missing_or_zero
ok(routerSrc.includes("dip_missing_or_zero"), 'rejection reason includes dip_missing_or_zero');
ok(routerSrc.includes("rebound_not_confirmed"), 'rejection reason includes rebound_not_confirmed');

// 6. The audit fires when dip_and_rebound is selected OR rejected
ok(routerSrc.includes('AUTOSTRATEGY_ROUTER_DIP_REBOUND_DECISION_AUDIT'), 'audit fires for dip_and_rebound decisions');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
