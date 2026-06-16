import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. DIP_REBOUND_ENTRY_CONTRACT_AUDIT exists
ok(engineSrc.includes('DIP_REBOUND_ENTRY_CONTRACT_AUDIT'), 'TradingEngine emits dip/rebound contract audit');

// 2. Contract audit fields
ok(engineSrc.includes('strategyAtEntry=${buySnapshot.selectedStrategy}'), 'contract audit exposes strategyAtEntry');
ok(engineSrc.includes('actualDipPctAtEntry=${Number.isFinite(actualDip)'), 'contract audit exposes actualDipPctAtEntry');
ok(engineSrc.includes('requiredDipPctAtEntry=${Number.isFinite(requiredDip)'), 'contract audit exposes requiredDipPctAtEntry');
ok(engineSrc.includes('actualReboundPctAtEntry=${Number.isFinite(actualRebound)'), 'contract audit exposes actualReboundPctAtEntry');
ok(engineSrc.includes('requiredReboundPctAtEntry=${Number.isFinite(requiredRebound)'), 'contract audit exposes requiredReboundPctAtEntry');
ok(engineSrc.includes('dipConfirmedAtEntry='), 'contract audit exposes dipConfirmedAtEntry');
ok(engineSrc.includes('reboundConfirmedAtEntry='), 'contract audit exposes reboundConfirmedAtEntry');
ok(engineSrc.includes('setupResultAtEntry='), 'contract audit exposes setupResultAtEntry');
ok(engineSrc.includes('contractValid=${String(contractValid)}'), 'contract audit exposes contractValid');
ok(engineSrc.includes('invalidReason=${invalidReason}'), 'contract audit exposes invalidReason');

// 3. DIP_REBOUND_ENTRY_CONTRACT_INVALID hard-fail
ok(engineSrc.includes('DIP_REBOUND_ENTRY_CONTRACT_INVALID'), 'TradingEngine emits contract invalid hard-fail');
ok(engineSrc.includes('positionCreateAllowed=false'), 'contract invalid blocks position creation');

// 4. Only fires for dip_and_rebound strategy
ok(engineSrc.includes("posStrategy === 'dip_and_rebound'"), 'contract check only for dip_and_rebound strategy');
ok(engineSrc.includes('posEntryRule.includes(\'DIP_AND_REBOUND\')'), 'contract check covers DIP_AND_REBOUND entry rule');

// 5. Invalid reasons tracked
ok(engineSrc.includes("'actualDipPct_missing_or_zero'"), 'contract tracks actualDipPct missing/zero reason');
ok(engineSrc.includes("'dip_below_requirement'"), 'contract tracks dip below requirement');
ok(engineSrc.includes("'rebound_below_requirement'"), 'contract tracks rebound below requirement');

// 6. Position is NOT added when contract is invalid (releaseLock before add)
ok(engineSrc.includes('releaseLock();') && engineSrc.includes('return;'), 'contract invalid releases lock and exits');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
