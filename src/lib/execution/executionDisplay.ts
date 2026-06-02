export type ExecutionModeDisplay = 'demo' | 'live';

export function getExecutionModeDisplay(adapterOrMode?: string | null): ExecutionModeDisplay {
  const value = (adapterOrMode ?? '').toLowerCase();
  return value.includes('live') || value.includes('binance') ? 'live' : 'demo';
}

export function getExecutionAdapterDisplay(adapter?: string | null): string {
  if (!adapter) return 'demo_simulated';
  if (adapter === 'paper_simulated') return 'demo_simulated';
  if (adapter === 'Paper') return 'Demo';
  if (adapter === 'paper') return 'demo';
  return adapter;
}

export function getExecutionControllerDisplay(controller?: string | null): string {
  if (!controller) return 'ExecutionController';
  if (controller === 'PaperAutoExecutionController') return 'DemoExecutionController';
  return controller;
}

export function getExecutionStageDisplay(stage?: string | null): string {
  if (!stage) return 'Pending';
  if (stage === 'PaperFillCreated') return 'DemoFillCreated';
  return stage;
}

export function sanitizeExecutionDisplayText(input?: string | null): string {
  if (!input) return '';
  return input
    .replaceAll('PAPER_EXECUTION_CONTROLLER_RECEIVED', 'DEMO_EXECUTION_CONTROLLER_RECEIVED')
    .replaceAll('PAPER_EXECUTION_ADAPTER_CALLED', 'DEMO_EXECUTION_ADAPTER_CALLED')
    .replaceAll('PAPER_EXECUTION_FILL_CREATED', 'DEMO_EXECUTION_FILL_CREATED')
    .replaceAll('PAPER_EXECUTION_ADAPTER_CONNECT_START', 'DEMO_EXECUTION_ADAPTER_CONNECT_START')
    .replaceAll('PAPER_EXECUTION_ADAPTER_UNAVAILABLE', 'DEMO_EXECUTION_ADAPTER_UNAVAILABLE')
    .replaceAll('PAPER_EXECUTION_ADAPTER_READY', 'DEMO_EXECUTION_ADAPTER_READY')
    .replaceAll('ENTRY_PLAN_CONSUMED_BY_PAPER_EXECUTION', 'ENTRY_PLAN_CONSUMED_BY_DEMO_EXECUTION')
    .replaceAll('PAPER_AUTO_BUY_EXECUTED', 'DEMO_AUTO_BUY_EXECUTED')
    .replaceAll('PAPER_AUTO_BUY_FAILED', 'DEMO_AUTO_BUY_FAILED')
    .replaceAll('PAPER_AUTO_BUY_BLOCKED', 'DEMO_AUTO_BUY_BLOCKED')
    .replaceAll('PAPER_AUTO_DISABLED', 'DEMO_AUTO_DISABLED')
    .replaceAll('PaperAutoExecutionController', 'DemoExecutionController')
    .replaceAll('paper_simulated', 'demo_simulated')
    .replaceAll('paperAutoEnabled', 'autoExecutionEnabled')
    .replaceAll('paper_auto', 'demo_auto')
    .replaceAll('PaperFillCreated', 'DemoFillCreated')
    .replaceAll('Paper Mode', 'Demo Mode')
    .replaceAll('Paper execution', 'Demo execution')
    .replaceAll('paper execution', 'demo execution')
    .replaceAll('Paper position', 'Demo position')
    .replaceAll('paper position', 'demo position')
    .replaceAll('Paper adapter', 'Demo adapter')
    .replaceAll('paper adapter', 'demo adapter')
    .replaceAll('Paper fill', 'Demo fill')
    .replaceAll('paper fill', 'demo fill')
    .replaceAll('Paper Auto', 'Demo Auto')
    .replaceAll('Paper auto', 'Demo auto')
    .replaceAll('paper auto', 'demo auto')
    .replaceAll('Paper trading', 'Demo trading')
    .replaceAll('paper trading', 'demo trading')
    .replaceAll('Paper', 'Demo')
    .replaceAll('paper', 'demo')
    .replaceAll('PAPER', 'DEMO');
}

export function buildExecutionModeParityAudit(input: {
  executionAdapter: 'paper_simulated' | 'binance_live';
  decisionMode: 'unified';
  plannerInputCount: number;
  plannerInputWithEntryPlan: number;
  generatedEntryPlanCount: number;
  selectedCount: number;
  selectedWithEntryPlan: number;
  entryGateSnapshotUsed: boolean;
  plannerUsed: boolean;
}): string {
  const executionAdapter = getExecutionAdapterDisplay(input.executionAdapter);
  const executionMode = getExecutionModeDisplay(input.executionAdapter);
  const finalAdapterOnlyDifference = input.decisionMode === 'unified' && input.plannerUsed;
  const parityOk =
    finalAdapterOnlyDifference &&
    input.entryGateSnapshotUsed &&
    (input.selectedCount === 0 ? input.selectedWithEntryPlan === 0 : input.selectedWithEntryPlan === input.selectedCount);

  return [
    'EXECUTION_MODE_PARITY_AUDIT:',
    `executionMode=${executionMode}`,
    `executionAdapter=${executionAdapter}`,
    `decisionMode=${input.decisionMode}`,
    'scannerPath=Scanner>EntryGate>ExecutionPlanner>ExecutionController>adapter',
    `entryGateSnapshotUsed=${String(input.entryGateSnapshotUsed)}`,
    `plannerUsed=${String(input.plannerUsed)}`,
    `plannerInputCount=${input.plannerInputCount}`,
    `plannerInputWithEntryPlan=${input.plannerInputWithEntryPlan}`,
    `generatedEntryPlanCount=${input.generatedEntryPlanCount}`,
    `selectedCount=${input.selectedCount}`,
    `selectedWithEntryPlan=${input.selectedWithEntryPlan}`,
    `finalAdapterOnlyDifference=${String(finalAdapterOnlyDifference)}`,
    `parityOk=${String(parityOk)}`,
  ].join(' ');
}
