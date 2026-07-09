import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSelectedToExecutionHandoffAccounting } from '../core/scanner/selectedToExecutionHandoffAccounting';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => condition ? passed++ : (failed++, console.error(`FAIL: ${label}`));
const eq = <T>(actual: T, expected: T, label: string) => ok(Object.is(actual, expected), `${label} (expected=${String(expected)} actual=${String(actual)})`);

const selectedNine = Array.from({ length: 9 }, (_, index) => `SYM${index + 1}USDT`);
const skippedEight = selectedNine.slice(1);
const oneEligible = selectedNine.slice(0, 1);

const removedBeforeController = buildSelectedToExecutionHandoffAccounting({
  rawSelectedSymbols: selectedNine,
  skippedBeforeControllerSymbols: skippedEight,
  controllerReceivedSymbols: oneEligible,
  submitEligibleSymbols: oneEligible,
  skippedBeforeSubmitSymbols: [],
});
eq(removedBeforeController.expectedControllerReceivedCount, 1, 'selected=9 skippedBeforeController=8 expects one controller candidate');
eq(removedBeforeController.actualControllerReceivedCount, 1, 'controller receives only the non-skipped candidate');
eq(removedBeforeController.countDelta, 0, 'controller count delta is zero when pre-controller skips are removed');
ok(removedBeforeController.invariantOk, 'pre-controller skip accounting is internally consistent');

const paperAuditRoute = buildSelectedToExecutionHandoffAccounting({
  rawSelectedSymbols: selectedNine,
  skippedBeforeControllerSymbols: [],
  controllerReceivedSymbols: selectedNine,
  submitEligibleSymbols: oneEligible,
  skippedBeforeSubmitSymbols: skippedEight,
});
eq(paperAuditRoute.expectedControllerReceivedCount, 9, 'paper audit route expects all raw selected candidates at controller audit');
eq(paperAuditRoute.actualControllerReceivedCount, 9, 'paper audit route can receive all selected candidates');
eq(paperAuditRoute.submitEligibleSymbols.length, 1, 'paper audit route can keep only one submit-eligible candidate');
eq(paperAuditRoute.skippedBeforeSubmitSymbols.length, 8, 'paper audit route classifies eight candidates before submit');
ok(paperAuditRoute.invariantOk, 'paper route does not produce false handoff error when submit skips are classified separately');

const mismatch = buildSelectedToExecutionHandoffAccounting({
  rawSelectedSymbols: selectedNine,
  skippedBeforeControllerSymbols: skippedEight,
  controllerReceivedSymbols: selectedNine,
  submitEligibleSymbols: oneEligible,
  skippedBeforeSubmitSymbols: skippedEight,
});
eq(mismatch.expectedControllerReceivedCount, 1, 'mismatch expected count preserves pre-controller formula');
eq(mismatch.actualControllerReceivedCount, 9, 'mismatch actual count captures raw controller count');
eq(mismatch.countDelta, 8, 'mismatch count delta identifies eight extra controller symbols');
ok(!mismatch.invariantOk, 'mismatch is still detected instead of hidden');
ok(mismatch.mismatchSymbols.length === 8, 'mismatch symbols identify the unexpected controller symbols');

const postControllerMismatch = buildSelectedToExecutionHandoffAccounting({
  rawSelectedSymbols: oneEligible,
  skippedBeforeControllerSymbols: [],
  controllerReceivedSymbols: oneEligible,
  submitEligibleSymbols: [...oneEligible, 'EXTRAUSDT'],
  skippedBeforeSubmitSymbols: [],
});
ok(!postControllerMismatch.invariantOk, 'submit-eligible symbols must have been received by controller');
ok(postControllerMismatch.unexpectedAfterControllerSymbols.includes('EXTRAUSDT'), 'post-controller mismatch identifies unexpected submit-eligible symbol');

const duplicatePostControllerAccounting = buildSelectedToExecutionHandoffAccounting({
  rawSelectedSymbols: oneEligible,
  skippedBeforeControllerSymbols: [],
  controllerReceivedSymbols: oneEligible,
  submitEligibleSymbols: oneEligible,
  skippedBeforeSubmitSymbols: oneEligible,
});
ok(!duplicatePostControllerAccounting.invariantOk, 'same symbol cannot be both submit-eligible and skipped-before-submit');
ok(duplicatePostControllerAccounting.submitAccountingOverlapSymbols.includes(oneEligible[0]), 'overlap symbol is reported');

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
ok(scannerSrc.includes('EXECUTION_HANDOFF_COUNT_INVARIANT_AUDIT'), 'MarketScanner emits count invariant audit');
ok(scannerSrc.includes('EXECUTION_HANDOFF_SKIPPED_CANDIDATES_AUDIT'), 'MarketScanner emits skipped candidates audit');
ok(scannerSrc.includes('PAPER_SIMULATED_HANDOFF_ROUTE_AUDIT'), 'MarketScanner emits paper route audit');
ok(scannerSrc.includes('skippedBeforeSubmitSymbols'), 'MarketScanner separates skipped-before-submit candidates');
ok(scannerSrc.includes('submitEligibleSymbols'), 'MarketScanner tracks submit-eligible symbols');
ok(scannerSrc.includes('expectedControllerReceivedCount=${accounting.expectedControllerReceivedCount}'), 'error/audit includes expected controller count');
ok(scannerSrc.includes('actualControllerReceivedCount=${accounting.actualControllerReceivedCount}'), 'error/audit includes actual controller count');
ok(scannerSrc.includes('countDelta=${accounting.countDelta}'), 'error/audit includes count delta');
ok(scannerSrc.includes('symbolsCausingMismatch=${accounting.mismatchSymbols.join'), 'error includes mismatch symbols');

if (failed > 0) {
  console.error(`selected-to-execution-handoff-accounting.test: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`selected-to-execution-handoff-accounting.test: ${passed} passed, ${failed} failed`);
