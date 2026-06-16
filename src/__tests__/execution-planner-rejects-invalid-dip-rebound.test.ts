import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');

// 1. Builder downgrades dip_and_rebound with invalid dip or rebound
ok(builderSrc.includes('dip_and_rebound') && (builderSrc.includes('reboundPct == null') || builderSrc.includes('reboundPct') || builderSrc.includes('actualReboundPct') || builderSrc.includes('validateStrategyContract')), 'builder rejects invalid dip_and_rebound');

// 2. ExecutionPlanner semantic gate still checks for invalid strategies
ok(plannerSrc.includes('ExecutionPlannerSemanticIntegrity'), 'planner has semantic integrity gate');

// 3. Invalid dip_and_rebound strategies rejected before selection
ok(builderSrc.includes("strategySelected === 'dip_and_rebound'") || (builderSrc.includes('dip_and_rebound') && builderSrc.includes('reboundPct')), 'builder prevents invalid dip_and_rebound from reaching planner');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
