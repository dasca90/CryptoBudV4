import { readFileSync } from 'node:fs';
import { createDefaultAppSettings } from '../core/types';
import { resolveMaxSelectedPerScanConfig } from '../core/settings/max-selected-per-scan';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const defaults = createDefaultAppSettings();
ok(defaults.maxSelectedPerScan === 10, 'no persisted config default maxSelectedPerScan is 10');
ok(defaults.maxEntriesPerCycle === 10, 'legacy mirror default is 10');

const uiResolved = resolveMaxSelectedPerScanConfig({ uiValue: 10, sourceHint: 'ui_setting', emitAudit: false });
ok(uiResolved.value === 10 && uiResolved.source === 'ui_setting', 'UI sets 10 and canonical resolver returns 10');

const legacyOnly = resolveMaxSelectedPerScanConfig({
  persistedLegacyMaxEntriesPerCycle: 4,
  emitAudit: false,
});
ok(legacyOnly.value === 10, 'old persisted maxEntriesPerCycle=4 without maxSelectedPerScan does not cap at 4');
ok(legacyOnly.source === 'legacy_migrated' && legacyOnly.migrationApplied, 'legacy-only config is clearly migrated');

const canonicalFour = resolveMaxSelectedPerScanConfig({
  persistedMaxSelectedPerScan: 4,
  persistedLegacyMaxEntriesPerCycle: 10,
  userExplicit: true,
  sourceHint: 'persisted_setting',
  emitAudit: false,
});
ok(canonicalFour.value === 4 && canonicalFour.source === 'persisted_setting', 'explicit canonical maxSelectedPerScan=4 remains allowed');

const stalePersistedFour = resolveMaxSelectedPerScanConfig({
  persistedMaxSelectedPerScan: 4,
  persistedLegacyMaxEntriesPerCycle: 4,
  userExplicit: false,
  sourceHint: 'persisted_setting',
  emitAudit: false,
});
ok(stalePersistedFour.value === 10, 'persisted 4/4 without user marker migrates to 10');
ok(stalePersistedFour.source === 'legacy_migrated' && stalePersistedFour.migrationApplied, 'persisted 4/4 without marker is audited as legacy migration');

const canonicalWins = resolveMaxSelectedPerScanConfig({
  maxSelectedPerScan: 10,
  maxEntriesPerCycle: 4,
  sourceHint: 'ui_setting',
  emitAudit: false,
});
ok(canonicalWins.value === 10, 'legacy mirror cannot override canonical value');

const clamped = resolveMaxSelectedPerScanConfig({ uiValue: 99, sourceHint: 'ui_setting', emitAudit: false });
ok(clamped.value === 20 && clamped.clamped, 'canonical value clamps to max 20');

const persistenceSrc = readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8');
const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts', 'utf8');
const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');

ok(persistenceSrc.includes('resolveMaxSelectedPerScanConfig'), 'SettingsPersistence uses canonical resolver');
ok(persistenceSrc.includes('maxSelectedPerScanUserSet'), 'SettingsPersistence persists explicit user marker');
ok(scannerSrc.includes('resolveMaxSelectedPerScanConfig') && scannerSrc.includes('source?: MaxSelectedPerScanSource'), 'MarketScanner resolves and tracks canonical source');
ok(plannerSrc.includes('maxSelectedPerScanSource') && plannerSrc.includes('source=${resolvedMaxSelected.source}'), 'ExecutionPlanner logs exact source');
ok(tradePageSrc.includes('scanner.setExecutionLimits') && tradePageSrc.includes("source: 'ui_setting'") && tradePageSrc.includes('userExplicit: airParams.maxSelectedPerScanUserSet === true'), 'TradePage pushes UI maxSelectedPerScan and explicit marker into scanner runtime');

if (failed > 0) {
  console.error(`max-selected-per-scan-runtime-config: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`max-selected-per-scan-runtime-config: ${passed} passed, ${failed} failed`);
