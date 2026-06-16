import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const typesSrc = readFileSync(path.resolve(process.cwd(), 'src/core/types/index.ts'), 'utf8');
const tradePageSrc = readFileSync(path.resolve(process.cwd(), 'src/ui/pages/TradePage.tsx'), 'utf8');

// Test 1: refWindow and refMode are now in AppSettings type
ok(typesSrc.includes("refWindow: 'AUTO'") || typesSrc.includes("refWindow: 'AUTO' | 'LAST_HOUR'"), 'Test 1a: refWindow is in AppSettings type');
ok(typesSrc.includes("refMode: 'AUTO'") || typesSrc.includes("refMode: 'AUTO' | 'SMA'"), 'Test 1b: refMode is in AppSettings type');

// Test 2: refWindow and refMode have defaults
ok(typesSrc.includes("refWindow: 'LAST_DAY'"), 'Test 2a: refWindow defaults to LAST_DAY');
ok(typesSrc.includes("refMode: 'SMA'"), 'Test 2b: refMode defaults to SMA');

// Test 3: Hydration mapping includes refWindow and refMode
ok(tradePageSrc.includes("s.refWindow ?? prev.refWindow"), 'Test 3a: Hydration maps refWindow from persisted settings');
ok(tradePageSrc.includes("s.refMode ?? prev.refMode"), 'Test 3b: Hydration maps refMode from persisted settings');

// Test 4: saveSettings includes refWindow and refMode
ok(tradePageSrc.includes("refWindow: airParams.refWindow"), 'Test 4a: Save includes refWindow');
ok(tradePageSrc.includes("refMode: airParams.refMode"), 'Test 4b: Save includes refMode');

// Test 5: Apply save includes missing scanner ranking fields
ok(tradePageSrc.includes("scannerCandidatePoolSize: airParams.scannerCandidatePoolSize"), 'Test 5a: Save includes scannerCandidatePoolSize');
ok(tradePageSrc.includes("momentumWeight: airParams.momentumWeight"), 'Test 5b: Save includes momentumWeight');
ok(tradePageSrc.includes("enableNewMoverBonus: airParams.enableNewMoverBonus"), 'Test 5c: Save includes enableNewMoverBonus');

// Test 6: TRADING_PARAMETERS_APPLY_AUDIT exists
ok(tradePageSrc.includes('TRADING_PARAMETERS_APPLY_AUDIT'), 'Test 6a: TRADING_PARAMETERS_APPLY_AUDIT exists');
ok(tradePageSrc.includes('submittedRefPeriod') && tradePageSrc.includes('submittedRefMode'), 'Test 6b: Apply audit includes refWindow and refMode');

// Test 7: TRADING_PARAMETERS_RESTORE_AUDIT exists
ok(tradePageSrc.includes('TRADING_PARAMETERS_RESTORE_AUDIT'), 'Test 7a: TRADING_PARAMETERS_RESTORE_AUDIT exists');
ok(tradePageSrc.includes('sourceUsed') && tradePageSrc.includes('usedDefaults'), 'Test 7b: Restore audit tracks sourceUsed and usedDefaults');

// Test 8: Hydration guard still active
ok(tradePageSrc.includes('USER_SETTINGS_DEFAULT_WRITE_BLOCKED_BEFORE_HYDRATION'), 'Test 8: Hydration guard blocks writes before ready');

// Test 9: AntiFomoMode mapped in hydration
ok(tradePageSrc.includes("antiFomoMode: (s as any).antiFomoMode"), 'Test 9: antiFomoMode loaded from persisted settings');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
