import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (c: boolean, m: string) => c ? passed++ : (failed++, console.error(`FAIL: ${m}`));

const src = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
const typesSrc = readFileSync('src/components/trade-v4/types.ts', 'utf8');
const defaultsSrc = readFileSync('src/core/types/index.ts', 'utf8');

ok(src.includes("const manualDipperLocked = v.strategySource === 'autobots' && !!auto"), '1 fields lock only in AutoBots mode with Auto ON');
ok(src.includes('Manual Override active — edit dip/rebound setup values manually.'), '2 manual override helper text shown');
ok(src.includes('MANUAL_DIPPER_MODE_STATE_AUDIT'), '3 mode state audit log exists');
ok(src.includes('MANUAL_DIPPER_AUTOBOTS_LOCK_CONFLICT'), '4 conflict log exists');
ok(src.includes('MANUAL_DIPPER_SETUP_SAVE_SUCCESS'), '5 manual setup save success log exists');
ok(src.includes('MANUAL_DIPPER_SETUP_RESTORED'), '6 manual setup restored log exists');
ok(src.includes('MANUAL_DIPPER_SETUP_EDITABLE_STATE_AUDIT'), '7 editable state audit exists');
ok(typesSrc.includes("strategySource: 'autobots' | 'manual_override'"), '8 strategy source supports manual override');
ok(defaultsSrc.includes('dipReboundMinDipPct: 0.8') && defaultsSrc.includes('dipReboundMinReboundPct: 0.4'), '9 dip-and-rebound defaults preserved');
ok(defaultsSrc.includes('conservativeMinDipPct: 2') && defaultsSrc.includes('conservativeMinReboundPct: 1'), '10 conservative defaults preserved');
ok(src.includes("disabled={manualDipperLocked}") && src.includes('momentumMinReboundPct') && src.includes('dipReboundMinDipPct') && src.includes('conservativeMinReboundPct'), '11 all manual dipper fields use lock state');

console.log(`manual-dipper-lock-conflict: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
