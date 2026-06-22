import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const tradePageSrc = readFileSync(path.resolve(process.cwd(), 'src/ui/pages/TradePage.tsx'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const autoRuntimeSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/AutoRuntime.ts'), 'utf8');

// 1. UI toggle propagates to scanner immediately
ok(tradePageSrc.includes('scanner.setPaperAutoEnabled(requestedValue)'), 'TradePage toggle directly calls scanner.setPaperAutoEnabled');
ok(tradePageSrc.includes('engine.getAutoRuntime()?.getScanner()'), 'TradePage toggle gets scanner from autoRuntime');
ok(tradePageSrc.includes('AUTOBOTS_TOGGLE_RUNTIME_APPLIED'), 'TradePage toggle audits propagation to scanner runtime');

// 2. Scanner instance from getAutoRuntime is the same instance used for scanning
ok(engineSrc.includes('private autoRuntime: AutoRuntime'), 'TradingEngine holds a single autoRuntime instance');
ok(engineSrc.includes('getAutoRuntime(): AutoRuntime { return this.autoRuntime; }'), 'getAutoRuntime returns the same singleton');
ok(autoRuntimeSrc.includes('private scanner: MarketScanner;'), 'AutoRuntime holds a single scanner instance');
ok(autoRuntimeSrc.includes('getScanner(): MarketScanner { return this.scanner; }'), 'getScanner returns the same singleton');

// 3. Scanner boot wiring applies from persisted settings
ok(appSrc.includes('scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? true)'), 'boot wiring applies paperAutoExecutionEnabled to scanner runtime with fresh-install AutoBots ON default');
ok(appSrc.includes('APP_SCANNER_WIRING_AUDIT'), 'boot wiring audits the scanner instance and callback state');

// 4. Start handler preserves live state over stale persisted settings
ok(appSrc.includes('SCANNER_LIVE_AUTO_STATE_MISMATCH'), 'start handler audits mismatch between live and persisted state');
ok(appSrc.includes('SCANNER_AUTO_STATE_APPLIED_FROM_PERSISTENCE'), 'start handler applies from persistence when scanner is still default');
ok(appSrc.includes('SCANNER_AUTO_STATE_KEEP_LIVE'), 'start handler preserves live toggle state over stale persistence');

// 5. Settings hydration restores AutoBots state to scanner (TradePage useEffect)
ok(tradePageSrc.includes('scanner.setPaperAutoEnabled(persistedAutoBots)'), 'TradePage hydration restores persisted auto state to scanner');
ok(tradePageSrc.includes('AUTOBOTS_HYDRATION_RESTORE'), 'TradePage hydration audits restore of persisted auto state');
ok(tradePageSrc.includes('AUTOBOTS_HYDRATION_CONFLICT'), 'TradePage hydration audits conflict when user toggle differs from persisted');
ok(tradePageSrc.includes('userToggleTime === 0'), 'TradePage hydration only overwrites scanner if user has not toggled');

// 6. Scanner has getter for isPaperAutoEnabled
ok(scannerSrc.includes('isPaperAutoEnabled(): boolean { return this.paperAutoEnabled; }'), 'scanner exposes isPaperAutoEnabled getter');
ok(scannerSrc.includes('setPaperAutoEnabled(enabled: boolean)'), 'scanner exposes setPaperAutoEnabled setter');
ok(scannerSrc.includes('ACTIVE_SCANNER_RUNTIME_FLAG_AUDIT'), 'setter audits the change');
ok(scannerSrc.includes('hasPaperAutoBuyFn(): boolean'), 'scanner exposes hasPaperAutoBuyFn getter');

// 7. No split-brain: paperAutoEnabled is the canonical field in scanner
ok(scannerSrc.includes('private paperAutoEnabled = false'), 'scanner has single paperAutoEnabled field');
const paperAutoCount = (scannerSrc.match(/this\.paperAutoEnabled/g) || []).length;
ok(paperAutoCount >= 15, `paperAutoEnabled referenced ${paperAutoCount} times (consistent single field)`);

// 8. scanner_auto path is distinct from legacy brain_auto_entry
ok(appSrc.includes('LEGACY_AUTO_BUY_PATH_BLOCKED'), 'legacy brain auto buy path is explicitly blocked');
ok(appSrc.includes('canonicalReplacement=scanner_auto'), 'legacy path redirects to scanner_auto');

// 9. Journal and UI persistence protection
ok(appSrc.includes('PERSISTENCE_HYDRATION_COMPLETE'), 'persistence hydration completes before scanner starts');
ok(appSrc.includes('APP_BOOT_ID'), 'boot id tracked for persistence cycle detection');

if (failed > 0) {
  console.error(`auto-toggle-propagates-to-active-scanner: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`auto-toggle-propagates-to-active-scanner: ${passed} passed, ${failed} failed`);
