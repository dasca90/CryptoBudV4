import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');

// 1. SCANNER_AUTO_EXECUTION_GATE_AUDIT emitted at scan entry
ok(scannerSrc.includes('SCANNER_AUTO_EXECUTION_GATE_AUDIT'), 'MarketScanner emits auto execution gate audit at scan entry');
ok(scannerSrc.includes('paperAutoExecutionEnabled=${String(this.paperAutoEnabled)}'), 'gate audit exposes paperAutoExecutionEnabled');
ok(scannerSrc.includes('paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)}'), 'gate audit exposes paperAutoBuyFnPresent');
ok(scannerSrc.includes('marketScannerPaperAutoEnabled=${String(this.paperAutoEnabled)}'), 'gate audit exposes marketScannerPaperAutoEnabled');
ok(scannerSrc.includes('autoBotsEnabled=${String(this.strategySourceMode'), 'gate audit exposes autoBotsEnabled');
ok(scannerSrc.includes('scannerAutoEnabled=${String(this.paperAutoEnabled)}'), 'gate audit exposes scannerAutoEnabled');
ok(scannerSrc.includes('canAttemptScannerAutoExecution=${String(canAttempt)}'), 'gate audit exposes canAttemptScannerAutoExecution');
ok(scannerSrc.includes('skipReason='), 'gate audit exposes skipReason');
ok(scannerSrc.includes('activeScannerInstanceId='), 'gate audit exposes activeScannerInstanceId');
ok(scannerSrc.includes('appScannerInstanceId='), 'gate audit exposes appScannerInstanceId');
ok(scannerSrc.includes('autoRuntimeScannerInstanceId='), 'gate audit exposes autoRuntimeScannerInstanceId');
ok(scannerSrc.includes('buildTimestamp='), 'gate audit exposes buildTimestamp');
ok(scannerSrc.includes('sourceFileVersion='), 'gate audit exposes sourceFileVersion');

// 2. SCANNER_EXECUTION_PHASE_GATE_AUDIT emitted before execution routing
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_GATE_AUDIT'), 'MarketScanner emits execution phase gate audit before routing');
ok(scannerSrc.includes('buyReadyCount='), 'phase gate audit exposes buyReadyCount');
ok(scannerSrc.includes('selectedCandidateCount='), 'phase gate audit exposes selectedCandidateCount');
ok(scannerSrc.includes('paperAutoEnabled=${String(this.paperAutoEnabled)}'), 'phase gate audit exposes paperAutoEnabled');
ok(scannerSrc.includes('paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)}'), 'phase gate audit exposes paperAutoBuyFnPresent');
ok(scannerSrc.includes('maxSelectedPerScan='), 'phase gate audit exposes maxSelectedPerScan');
ok(scannerSrc.includes('availableSlots='), 'phase gate audit exposes availableSlots');
ok(scannerSrc.includes('capitalAvailable='), 'phase gate audit exposes capitalAvailable');
ok(scannerSrc.includes('capitalPerTrade='), 'phase gate audit exposes capitalPerTrade');
ok(scannerSrc.includes('canExecute=${String(canExecuteGate)}'), 'phase gate audit exposes canExecute');
ok(scannerSrc.includes('skipReason='), 'phase gate audit exposes skipReason');

// 3. SCANNER_EXECUTION_PHASE_START still present
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_START'), 'MarketScanner still emits execution phase start');

// 4. Explicit skip when AutoBots OFF
ok(scannerSrc.includes("reason=auto_execution_disabled paperAutoEnabled=${String(this.paperAutoEnabled)}"), 'MarketScanner emits explicit skip when auto execution disabled');

// 5. Enhanced SCANNER_EXECUTION_PHASE_MISSING_FATAL
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_MISSING_FATAL'), 'MarketScanner emits fatal audit when candidates should reach handoff but do not');
ok(scannerSrc.includes('missingFatalSkipReason'), 'enhanced fatal audit computes skipReason variable');
ok(scannerSrc.includes('marketScannerPaperAutoEnabled=${String(this.paperAutoEnabled)}'), 'enhanced fatal audit exposes marketScannerPaperAutoEnabled');
ok(scannerSrc.includes('plannerTopNoBuy='), 'enhanced fatal audit exposes plannerTopNoBuy');

// 6. Base execution audits still present
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_END'), 'MarketScanner emits execution phase end');
ok(scannerSrc.includes('SCANNER_EXECUTION_SKIPPED_AUDIT'), 'MarketScanner emits execution skipped audit');
ok(scannerSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT'), 'MarketScanner emits handoff audit');
ok(scannerSrc.includes('EXECUTION_ROUTING_AUDIT'), 'MarketScanner emits routing audit');

// 7. Execution only proceeds when all conditions met
ok(scannerSrc.includes("adapter === 'paper_simulated' && this.paperAutoEnabled && this.paperAutoBuyFn"), 'execution requires paperAutoEnabled AND paperAutoBuyFn');
ok(scannerSrc.includes("const blockReason = !this.paperAutoEnabled"), 'explicit blocker computed when auto disabled');

if (failed > 0) {
  console.error(`scanner-execution-gate-audit: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`scanner-execution-gate-audit: ${passed} passed, ${failed} failed`);
