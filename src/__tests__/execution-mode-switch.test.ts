import { evaluateExecutionModeSwitch } from '../core/live/ExecutionModeSwitchPolicy';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function check(condition: unknown, name: string): void {
  if (condition) { passed++; console.log(`PASS: ${name}`); }
  else { failed++; console.error(`FAIL: ${name}`); }
}

const base = { currentMode: 'DEMO' as const, targetMode: 'LIVE' as const, liveState: 'LIVE_CHECK_REQUIRED' as const, liveCheckPassed: false, openLivePositionCount: 0 };
check(!evaluateExecutionModeSwitch(base).allowed, 'LIVE is blocked before Live Check');
check(!evaluateExecutionModeSwitch({ ...base, liveState: 'LIVE_READY' }).allowed, 'LIVE is blocked without a passing check result');
check(evaluateExecutionModeSwitch({ ...base, liveState: 'LIVE_READY', liveCheckPassed: true }).allowed, 'LIVE is allowed after a passing check');
check(!evaluateExecutionModeSwitch({ ...base, currentMode: 'LIVE', targetMode: 'DEMO', liveState: 'LIVE_RUNNING', liveCheckPassed: true, openLivePositionCount: 1 }).allowed, 'DEMO switch is blocked with open LIVE exposure');
check(evaluateExecutionModeSwitch({ ...base, currentMode: 'LIVE', targetMode: 'DEMO', liveState: 'LIVE_RUNNING', liveCheckPassed: true, openLivePositionCount: 0 }).allowed, 'DEMO switch is allowed without LIVE exposure');
check(evaluateExecutionModeSwitch({ ...base, currentMode: 'DEMO', targetMode: 'DEMO' }).noOp, 'selecting active DEMO mode is a no-op');
check(evaluateExecutionModeSwitch({ ...base, currentMode: 'LIVE', targetMode: 'LIVE', liveState: 'LIVE_RUNNING', liveCheckPassed: true }).noOp, 'selecting active LIVE mode is a no-op');

const app = readFileSync('src/App.tsx', 'utf8');
const settings = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
const topBar = readFileSync('src/components/layout/TopBar.tsx', 'utf8');
check(app.includes('handleExecutionModeChange') && app.includes('evaluateExecutionModeSwitch'), 'App uses centralized runtime switch policy');
check(settings.includes("handleModeChange('DEMO')") && settings.includes("handleModeChange('LIVE')"), 'Settings exposes DEMO/LIVE switch');
check(topBar.includes("changeMode('DEMO')") && topBar.includes("changeMode('LIVE')"), 'Top bar exposes DEMO/LIVE switch');
check(app.includes('setLiveCheckResult(null)') && app.includes("LIVE_CHECK_REQUIRED"), 'switching back to DEMO invalidates prior Live Check');

console.log(`execution-mode-switch: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
