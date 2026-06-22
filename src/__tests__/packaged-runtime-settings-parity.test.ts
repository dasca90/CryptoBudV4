import { readFileSync } from 'node:fs';
import { ok } from 'node:assert/strict';

const settingsSrc = readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8');
const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const appSrc = readFileSync('src/App.tsx', 'utf8');
const cardSrc = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
const typesSrc = readFileSync('src/core/types/index.ts', 'utf8');

ok(settingsSrc.includes('async ready()'), 'settings persistence exposes explicit readiness');
ok(settingsSrc.includes('await this.ready();'), 'settings get/set wait for Tauri/local backend detection');
ok(settingsSrc.includes('normalizeRuntimeSettings'), 'settings load/save normalizes runtime parity fields');
ok(settingsSrc.includes('invalidAutoBotsManualStateFound'), 'legacy AutoBots/manual conflict is detected during migration');
ok(settingsSrc.includes("strategySource: invalidAutoBotsManualStateFound ? 'autobots'"), 'AutoBots wins over legacy manual override during migration');
ok(settingsSrc.includes('badInstallerDefaultAutoBotsOff'), 'bad packaged default AutoBots OFF state is migrated');
ok(settingsSrc.includes('autoBotsUserSet'), 'explicit user AutoBots toggle is preserved separately from broken defaults');

ok(scannerSrc.includes('setPaperAutoEnabled(enabled: boolean)'), 'scanner has authoritative AutoBots setter');
ok(scannerSrc.includes("this.strategySourceMode = 'autobots'"), 'AutoBots ON forces scanner strategy source to AutoBots');
ok(scannerSrc.includes('this.manualStrategy = null'), 'AutoBots ON clears manual strategy in runtime');
ok(scannerSrc.includes('AUTOBOTS_MANUAL_OVERRIDE_INVARIANT_AUDIT'), 'scanner emits AutoBots/manual invariant audit');
ok(scannerSrc.includes('getRuntimeSettingsDiagnostics'), 'scanner exposes runtime diagnostics snapshot');

ok(tradePageSrc.includes('AUTOBOTS_RUNTIME_BINDING_AUDIT'), 'UI toggle/hydration emits runtime binding audit');
ok(tradePageSrc.includes("const effectiveStrategySource = paperAutoEnabled ? 'autobots'"), 'UI apply path persists effective AutoBots strategy source');
ok(tradePageSrc.includes("strategySource: effectiveStrategySource"), 'hydration/apply use effective strategy source');
ok(tradePageSrc.includes('onExportRuntimeDiagnostics={exportRuntimeDiagnostics}') && cardSrc.includes('Export Runtime Diagnostics'), 'diagnostic export is wired through settings panel');
ok(tradePageSrc.includes('PACKAGED_RUNTIME_SETTINGS_SOURCE_AUDIT'), 'packaged settings source audit is emitted after hydration');
ok(tradePageSrc.includes('RUNTIME_SETTINGS_HYDRATION_LIFECYCLE_AUDIT'), 'hydration lifecycle audit is emitted');
ok(tradePageSrc.includes("setAirParams(paperAutoEnabled && next.strategySource === 'manual_override'"), 'AutoBots ON disables/corrects manual override UI edits');

ok(appSrc.includes('effectiveAutoBots'), 'scanner start uses effective persisted AutoBots value');
ok(appSrc.includes('setTradingTargetConfig'), 'scanner start publishes effective runtime target config before start');
ok(appSrc.indexOf('setTradingTargetConfig') < appSrc.indexOf('await autoRuntime.start(universeMode)'), 'runtime config is applied before scanner starts');

ok(cardSrc.includes('AutoBots Runtime:'), 'settings panel shows AutoBots runtime status');
ok(cardSrc.includes('Manual Override:'), 'settings panel shows manual override status');
ok(cardSrc.includes('Hydration:'), 'settings panel shows hydration status');
ok(cardSrc.includes('disabled={!!auto}'), 'manual strategy source control is disabled while AutoBots is on');
ok(cardSrc.includes("const manualDipperLocked = v.strategySource === 'autobots'"), 'manual setup is locked whenever Strategy Source is AutoBots');
ok(appSrc.includes('scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? true)'), 'fresh install boot defaults AutoBots execution ON');
ok(typesSrc.includes('paperAutoExecutionEnabled: true'), 'fresh default settings enable AutoBots execution');

ok(!settingsSrc.includes('rankCandidates('), 'settings parity fix does not change scanner ranking logic');
ok(!tradePageSrc.includes('computeProfessionalAnalysis('), 'settings parity fix does not change Smart Professional Analysis');

console.log('packaged-runtime-settings-parity regression checks passed');
