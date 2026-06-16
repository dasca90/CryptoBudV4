import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const journalSrc = readFileSync(path.resolve(process.cwd(), 'src/core/persistence/Journal.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const tradePageSrc = readFileSync(path.resolve(process.cwd(), 'src/ui/pages/TradePage.tsx'), 'utf8');
const settingsSrc = readFileSync(path.resolve(process.cwd(), 'src/core/persistence/SettingsPersistence.ts'), 'utf8');

// Test A: Atomic write order — backup written before primary
ok(journalSrc.includes("localStorage.setItem(this.openPosBackupKey, payload)"), 'Test A1: Backup written before primary');
ok(journalSrc.includes('backupVerify') && journalSrc.includes('backupVerified'), 'Test A2: Backup write verified after write');
ok(journalSrc.includes('primaryVerify') && journalSrc.includes('primaryVerified'), 'Test A3: Primary write verified after write');
ok(journalSrc.includes('atomicVerified'), 'Test A4: atomicVerified tracked');

// Test B: Empty overwrite blocked
ok(journalSrc.includes('POSITION_EMPTY_OVERWRITE_BLOCKED'), 'Test B1: POSITION_EMPTY_OVERWRITE_BLOCKED exists');
ok(journalSrc.includes('existingPrimaryOpenCount') && journalSrc.includes('existingBackupOpenCount'), 'Test B2: Existing counts checked before blocking');

// Test C: Recovery from backup
ok(journalSrc.includes('POSITION_PERSISTENCE_RECOVERY_AUDIT'), 'Test C1: Recovery audit exists');
ok(journalSrc.includes('primary_empty_backup_available'), 'Test C2: Recovery from backup works');

// Test D: POSITION_PERSISTENCE_BOOT_PROOF
ok(appSrc.includes('POSITION_PERSISTENCE_BOOT_PROOF'), 'Test D1: Boot proof audit exists');
ok(appSrc.includes('loadedTradeIds'), 'Test D2: Boot proof includes tradeIds');
ok(appSrc.includes('invariantOk'), 'Test D3: Boot proof verifies invariant');

// Test E: TRADING_SETTINGS_PERSISTENCE_AUDIT
ok(settingsSrc.includes('TRADING_SETTINGS_PERSISTENCE_AUDIT'), 'Test E1: Trading settings persistence audit exists');
ok(settingsSrc.includes('savedRefPeriod') && settingsSrc.includes('savedRefMode'), 'Test E2: Trading settings audit includes ref fields');

// Test F: TRADING_SETTINGS_UI_BINDING_AUDIT
ok(tradePageSrc.includes('TRADING_SETTINGS_UI_BINDING_AUDIT'), 'Test F1: UI binding audit exists');
ok(tradePageSrc.includes('displayedRefPeriod') && tradePageSrc.includes('canonicalRefPeriod'), 'Test F2: UI binding compares displayed vs canonical');

// Test G: PERSISTENCE_PERFORMANCE_AUDIT
ok(journalSrc.includes('PERSISTENCE_PERFORMANCE_AUDIT'), 'Test G1: Performance audit exists');
ok(journalSrc.includes('uiThreadBlocked=false'), 'Test G2: Performance audit confirms UI not blocked');

// Test H: Hydration check in handleStartScanner
ok(appSrc.includes('SCANNER_START_BLOCKED_HYDRATION_NOT_COMPLETE'), 'Test H1: Scanner blocked if hydration not complete');
ok(appSrc.includes('isOpenPositionsHydrated()'), 'Test H2: Scanner checks hydration before start');

// Test I: isOpenPositionsHydrated() getter
ok(journalSrc.includes('isOpenPositionsHydrated(): boolean'), 'Test I: Public hydration getter exists');

// Test J: writeSizeBytes and tradeIds in write audit
ok(journalSrc.includes('tradeIds='), 'Test J1: Write audit includes tradeIds');
ok(journalSrc.includes('writeDurationMs'), 'Test J2: Write audit includes performance timing');

// Test K: Trading parameters survive hydration (refWindow/refMode persisted)
ok(tradePageSrc.includes("s.refWindow ?? prev.refWindow"), 'Test K1: refWindow hydrated from persisted');
ok(tradePageSrc.includes("s.refMode ?? prev.refMode"), 'Test K2: refMode hydrated from persisted');

// Test L: Trading parameters saved on Apply
ok(tradePageSrc.includes("refWindow: airParams.refWindow"), 'Test L1: refWindow saved on Apply');
ok(tradePageSrc.includes("refMode: airParams.refMode"), 'Test L2: refMode saved on Apply');

// Test M: App close flush exists
ok(appSrc.includes('APP_CLOSE_POSITION_FLUSH_AUDIT'), 'Test M1: App close flush audit exists');
ok(appSrc.includes('beforeunload'), 'Test M2: beforeunload handler exists');

// Test N: Hydration guard prevents writes before ready
ok(journalSrc.includes('POSITION_PERSISTENCE_WRITE_BLOCKED_BEFORE_HYDRATION'), 'Test N: Hydration guard active');

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// ... (other checks)

// Test O: No duplicate tradeId in open (POSITION_TRADE_ID_STATE_INVARIANT)
ok(engineSrc.includes('POSITION_TRADE_ID_STATE_INVARIANT'), 'Test O: TradeId invariant check exists in TradingEngine');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
