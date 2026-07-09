export type SelectedToExecutionHandoffAccountingInput = {
  rawSelectedSymbols: string[];
  skippedBeforeControllerSymbols: string[];
  controllerReceivedSymbols: string[];
  submitEligibleSymbols: string[];
  skippedBeforeSubmitSymbols: string[];
};

export type SelectedToExecutionHandoffAccounting = {
  rawSelectedSymbols: string[];
  skippedBeforeControllerSymbols: string[];
  eligibleForControllerSymbols: string[];
  controllerReceivedSymbols: string[];
  submitEligibleSymbols: string[];
  skippedBeforeSubmitSymbols: string[];
  missingBeforeControllerSymbols: string[];
  unexpectedControllerSymbols: string[];
  missingAfterControllerSymbols: string[];
  unexpectedAfterControllerSymbols: string[];
  submitAccountingOverlapSymbols: string[];
  expectedControllerReceivedCount: number;
  actualControllerReceivedCount: number;
  countDelta: number;
  controllerInvariantOk: boolean;
  submitInvariantOk: boolean;
  invariantOk: boolean;
  invariantFormulaUsed: string;
  mismatchSymbols: string[];
};

const unique = (symbols: string[]): string[] => Array.from(new Set(
  symbols
    .map((symbol) => String(symbol ?? '').trim())
    .filter(Boolean),
));

const without = (symbols: string[], excluded: Set<string>): string[] => symbols.filter((symbol) => !excluded.has(symbol));

export function buildSelectedToExecutionHandoffAccounting(
  input: SelectedToExecutionHandoffAccountingInput,
): SelectedToExecutionHandoffAccounting {
  const rawSelectedSymbols = unique(input.rawSelectedSymbols);
  const skippedBeforeControllerSymbols = unique(input.skippedBeforeControllerSymbols);
  const controllerReceivedSymbols = unique(input.controllerReceivedSymbols);
  const submitEligibleSymbols = unique(input.submitEligibleSymbols);
  const skippedBeforeSubmitSymbols = unique(input.skippedBeforeSubmitSymbols);
  const skippedBeforeControllerSet = new Set(skippedBeforeControllerSymbols);
  const controllerReceivedSet = new Set(controllerReceivedSymbols);
  const submitEligibleSet = new Set(submitEligibleSymbols);
  const skippedBeforeSubmitSet = new Set(skippedBeforeSubmitSymbols);
  const eligibleForControllerSymbols = without(rawSelectedSymbols, skippedBeforeControllerSet);
  const expectedControllerSet = new Set(eligibleForControllerSymbols);
  const missingBeforeControllerSymbols = eligibleForControllerSymbols.filter((symbol) => !controllerReceivedSet.has(symbol));
  const unexpectedControllerSymbols = controllerReceivedSymbols.filter((symbol) => !expectedControllerSet.has(symbol));
  const afterControllerSymbols = unique([...submitEligibleSymbols, ...skippedBeforeSubmitSymbols]);
  const afterControllerSet = new Set(afterControllerSymbols);
  const missingAfterControllerSymbols = controllerReceivedSymbols.filter((symbol) => !submitEligibleSet.has(symbol) && !skippedBeforeSubmitSet.has(symbol));
  const unexpectedAfterControllerSymbols = afterControllerSymbols.filter((symbol) => !controllerReceivedSet.has(symbol));
  const submitAccountingOverlapSymbols = submitEligibleSymbols.filter((symbol) => skippedBeforeSubmitSet.has(symbol));
  const expectedControllerReceivedCount = eligibleForControllerSymbols.length;
  const actualControllerReceivedCount = controllerReceivedSymbols.length;
  const countDelta = actualControllerReceivedCount - expectedControllerReceivedCount;
  const controllerInvariantOk = countDelta === 0
    && missingBeforeControllerSymbols.length === 0
    && unexpectedControllerSymbols.length === 0;
  const submitInvariantOk = missingAfterControllerSymbols.length === 0
    && unexpectedAfterControllerSymbols.length === 0
    && submitAccountingOverlapSymbols.length === 0;
  const mismatchSymbols = unique([
    ...missingBeforeControllerSymbols,
    ...unexpectedControllerSymbols,
    ...missingAfterControllerSymbols,
    ...unexpectedAfterControllerSymbols,
    ...submitAccountingOverlapSymbols,
  ]);
  return {
    rawSelectedSymbols,
    skippedBeforeControllerSymbols,
    eligibleForControllerSymbols,
    controllerReceivedSymbols,
    submitEligibleSymbols,
    skippedBeforeSubmitSymbols,
    missingBeforeControllerSymbols,
    unexpectedControllerSymbols,
    missingAfterControllerSymbols,
    unexpectedAfterControllerSymbols,
    submitAccountingOverlapSymbols,
    expectedControllerReceivedCount,
    actualControllerReceivedCount,
    countDelta,
    controllerInvariantOk,
    submitInvariantOk,
    invariantOk: controllerInvariantOk && submitInvariantOk,
    invariantFormulaUsed: 'rawSelected - skippedBeforeController = eligibleForController = controllerReceived; controllerReceived = submitEligible + skippedBeforeSubmit',
    mismatchSymbols,
  };
}
