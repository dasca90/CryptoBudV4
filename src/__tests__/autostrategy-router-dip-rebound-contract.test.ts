import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const routerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/AutoStrategyRouter.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Router requires dipPct < 0 for dip_and_rebound in bearish group
ok(routerSrc.includes('reboundConfirmed && dipPct < 0 && tpRoomOk'), 'router requires dipPct<0 for bearish dip_and_rebound');

// 2. Router requires dipPct < 0 for caution group
ok(routerSrc.includes('confidence >= 70 && reboundConfirmed && dipPct < 0'), 'router requires dipPct<0 for caution dip_and_rebound');

// 3. Router requires dipPct < 0 for waiting_for_rebound
// 3. Router requires dipPct < 0 for waiting_for_rebound
ok(routerSrc.includes('reboundConfirmed && dipPct < 0 && tpRoomOk') && routerSrc.includes("Dip and rebound setup detected"), 'router requires dipPct<0 for waiting_rebound dip_and_rebound');

// 4. Router requires dipPct < 0 for sideways dip_and_rebound
ok(routerSrc.includes('reboundConfirmed && dipPct < 0 && tpRoomOk && spreadPct < 0.5 && priceFresh && !overextended'), 'router requires dipPct<0 for sideways dip_and_rebound');

// 5. AUTOSTRATEGY_ROUTER_DIP_REBOUND_DECISION_AUDIT exists
ok(routerSrc.includes('AUTOSTRATEGY_ROUTER_DIP_REBOUND_DECISION_AUDIT'), 'router emits dip/rebound decision audit');

// 6. Audit includes all required fields
ok(routerSrc.includes('marketRecommendedStrategy=${groupRecommendedStrategy}'), 'audit exposes marketRecommendedStrategy');
ok(routerSrc.includes('actualDipPct=${dipPct'), 'audit exposes actualDipPct');
ok(routerSrc.includes('actualReboundPct=${reboundPct'), 'audit exposes actualReboundPct');
ok(routerSrc.includes('dipConfirmed=${String(dipPct != null && dipPct < 0)}'), 'audit exposes dipConfirmed');
ok(routerSrc.includes('rejectedDipAndRebound=${String(rejected)}'), 'audit exposes rejectedDipAndRebound');
ok(routerSrc.includes('rejectionReason=${rejectionReason}'), 'audit exposes rejectionReason');

// 7. Logger imported in router
ok(routerSrc.includes("import { logger } from '../../utils/logger'"), 'router imports logger');

// 8. reboundPct destructured from input
ok(routerSrc.includes('dipPct, reboundPct, momentumPct'), 'router destructures reboundPct');

// 9. Builder validates via strategy contract
ok(builderSrc.includes('validateStrategyContract'), 'builder validates dip_and_rebound via contract');

// 10. AUTOSTRATEGY_ROUTER_INVALID_OUTPUT_REPAIRED in engine
ok(engineSrc.includes('AUTOSTRATEGY_ROUTER_INVALID_OUTPUT_REPAIRED'), 'engine warns on repaired router output');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
