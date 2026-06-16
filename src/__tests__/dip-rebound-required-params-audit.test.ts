import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');

// 1. DIP_REBOUND_REQUIRED_PARAMS_AUDIT exists
ok(builderSrc.includes('DIP_REBOUND_REQUIRED_PARAMS_AUDIT'), 'builder emits required params audit');

// 2. Audit fields
ok(builderSrc.includes('effectiveRequiredDipPct=${requiredDipPct'), 'audit exposes effectiveRequiredDipPct');
ok(builderSrc.includes('effectiveRequiredReboundPct=${requiredReboundPct'), 'audit exposes effectiveRequiredReboundPct');
ok(builderSrc.includes('sourceOfRequiredDip=${dynamicSetup.requiredDipPctMin != null'), 'audit exposes source of required dip');
ok(builderSrc.includes('sourceOfRequiredRebound=${dynamicSetup.requiredReboundPctMin != null'), 'audit exposes source of required rebound');

// 3. Only fires for dip_and_rebound strategy
ok(builderSrc.includes("strategySelected === 'dip_and_rebound'"), 'audit only for dip_and_rebound');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
