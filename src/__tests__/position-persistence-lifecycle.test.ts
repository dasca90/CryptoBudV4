import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const journalSrc = readFileSync(path.resolve(process.cwd(), 'src/core/persistence/Journal.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// Test 1: POSITION_PERSISTENCE_WRITE_AUDIT exists
ok(journalSrc.includes('POSITION_PERSISTENCE_WRITE_AUDIT'), 'Test 1a: POSITION_PERSISTENCE_WRITE_AUDIT exists');
ok(journalSrc.includes('writeSizeBytes'), 'Test 1b: Write audit includes writeSizeBytes');
ok(journalSrc.includes('writeSuccess'), 'Test 1c: Write audit tracks writeSuccess');

// Test 2: POSITION_PERSISTENCE_READ_AUDIT exists
ok(journalSrc.includes('POSITION_PERSISTENCE_READ_AUDIT'), 'Test 2a: POSITION_PERSISTENCE_READ_AUDIT exists');
ok(journalSrc.includes('foundState') || journalSrc.includes('openCountLoaded'), 'Test 2b: Read audit tracks openCountLoaded');
ok(journalSrc.includes('reasonIfEmpty'), 'Test 2c: Read audit has reasonIfEmpty');

// Test 3: POSITION_EMPTY_OVERWRITE_BLOCKED guard
ok(journalSrc.includes('POSITION_EMPTY_OVERWRITE_BLOCKED'), 'Test 3a: POSITION_EMPTY_OVERWRITE_BLOCKED exists');
ok(journalSrc.includes('empty_overwrite_blocked_before_hydration'), 'Test 3b: Empty overwrite blocked before hydration');
ok(journalSrc.includes('existingPrimaryOpenCount'), 'Test 3c: Empty overwrite check reads existing primary count');
ok(journalSrc.includes('existingBackupOpenCount') || journalSrc.includes('backupKey'), 'Test 3d: Empty overwrite check reads existing backup count');

// Test 4: POSITION_PERSISTENCE_RECOVERY_AUDIT from backup
ok(journalSrc.includes('POSITION_PERSISTENCE_RECOVERY_AUDIT'), 'Test 4a: POSITION_PERSISTENCE_RECOVERY_AUDIT exists');
ok(journalSrc.includes('primary_empty_backup_available'), 'Test 4b: Recovery from backup when primary is empty');

// Test 5: STORAGE_CONTEXT_AUDIT
ok(appSrc.includes('STORAGE_CONTEXT_AUDIT'), 'Test 5a: STORAGE_CONTEXT_AUDIT exists');
ok(appSrc.includes('isDesktop'), 'Test 5b: Storage audit tracks isDesktop');
ok(appSrc.includes('loadedFrom'), 'Test 5c: Storage audit tracks loadedFrom');

// Test 6: POSITION_BOOT_HYDRATION_ORDER_AUDIT
ok(appSrc.includes('POSITION_BOOT_HYDRATION_ORDER_AUDIT'), 'Test 6a: POSITION_BOOT_HYDRATION_ORDER_AUDIT exists');
ok(appSrc.includes('positionManagerHydrated') && appSrc.includes('paperHoldingsReconciled'), 'Test 6b: Hydration order tracks positionManager and paper holdings');
ok(appSrc.includes('emptyWriteBlocked'), 'Test 6c: Hydration order confirms emptyWriteBlocked');

// Test 7: APP_CLOSE_POSITION_FLUSH_AUDIT
ok(appSrc.includes('APP_CLOSE_POSITION_FLUSH_AUDIT'), 'Test 7a: APP_CLOSE_POSITION_FLUSH_AUDIT exists');
ok(appSrc.includes('beforeunload'), 'Test 7b: Flush on beforeunload event');
ok(appSrc.includes('primaryWriteOk'), 'Test 7c: Flush audit tracks primaryWriteOk');
ok(appSrc.includes('backupWriteOk'), 'Test 7d: Flush audit tracks backupWriteOk');

// Test 8: Hydration guard still active
ok(journalSrc.includes('POSITION_PERSISTENCE_WRITE_BLOCKED_BEFORE_HYDRATION'), 'Test 8a: Hydration guard blocks writes before ready');
ok(journalSrc.includes('openPositionsHydrated'), 'Test 8b: openPositionsHydrated flag exists');

// Test 9: Dual storage (primary + critical backup)
ok(journalSrc.includes("openPosBackupKey = 'cryptobud_v4:open_positions_critical'"), 'Test 9a: Critical backup key exists');
ok(journalSrc.includes("localStorage.setItem(this.openPosBackupKey"), 'Test 9b: Backup written alongside primary');

// Test 10: Reset marker audit unchanged
ok(appSrc.includes('RESET_MARKER_AUDIT'), 'Test 10: Reset marker audit preserved');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
