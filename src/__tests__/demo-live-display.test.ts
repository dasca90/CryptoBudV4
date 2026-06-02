import { readFileSync } from 'node:fs';
import { logger } from '../utils/logger';
import {
  buildExecutionModeParityAudit,
  getExecutionAdapterDisplay,
  getExecutionModeDisplay,
  getExecutionStageDisplay,
  sanitizeExecutionDisplayText,
} from '../lib/execution/executionDisplay';

let passed = 0;
let failed = 0;
const ok = (condition: boolean, label: string) => condition ? passed++ : (failed++, console.error(`FAIL: ${label}`));

ok(getExecutionModeDisplay('paper_simulated') === 'demo', 'executionMode display maps paper_simulated to demo');
ok(getExecutionAdapterDisplay('paper_simulated') === 'demo_simulated', 'executionAdapter display maps paper_simulated to demo_simulated');
ok(getExecutionAdapterDisplay('Paper') === 'Demo', 'technical Paper adapter display maps to Demo');
ok(getExecutionStageDisplay('PaperFillCreated') === 'DemoFillCreated', 'visible fill stage maps to DemoFillCreated');

const legacyLog = 'PAPER_EXECUTION_CONTROLLER_RECEIVED executionAdapter=paper_simulated routedController=PaperAutoExecutionController reason=Paper fill created';
const visibleLog = sanitizeExecutionDisplayText(legacyLog);
ok(visibleLog.includes('DEMO_EXECUTION_CONTROLLER_RECEIVED'), 'visible logs use DEMO_EXECUTION_CONTROLLER_RECEIVED');
ok(visibleLog.includes('executionAdapter=demo_simulated'), 'visible logs use demo_simulated adapter');
ok(!visibleLog.includes('Paper') && !visibleLog.includes('paper') && !visibleLog.includes('PAPER'), 'visible logs do not expose Paper wording');

logger.clear();
logger.info(legacyLog);
const exported = logger.export();
ok(exported.includes('DEMO_EXECUTION_CONTROLLER_RECEIVED'), 'exported logs use Demo wording');
ok(!exported.includes('Paper') && !exported.includes('paper') && !exported.includes('PAPER'), 'exported logs do not expose Paper wording');

const audit = buildExecutionModeParityAudit({
  executionAdapter: 'paper_simulated',
  decisionMode: 'unified',
  plannerInputCount: 1,
  plannerInputWithEntryPlan: 1,
  generatedEntryPlanCount: 0,
  selectedCount: 1,
  selectedWithEntryPlan: 1,
  entryGateSnapshotUsed: true,
  plannerUsed: true,
});
ok(audit.includes('executionMode=demo'), 'parity audit reports executionMode=demo');
ok(audit.includes('executionAdapter=demo_simulated'), 'parity audit reports executionAdapter=demo_simulated');
ok(audit.includes('finalAdapterOnlyDifference=true'), 'parity audit confirms final adapter is the only difference');
ok(audit.includes('parityOk=true'), 'parity audit reports parityOk=true');

const topStatus = readFileSync('src/components/trade-v4/TopStatusBar.tsx', 'utf8');
const selectedInspector = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
const settingsPage = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
const demoAdapterSrc = readFileSync('src/core/exchange/PaperExchangeAdapter.ts', 'utf8');
ok(topStatus.includes('"DEMO"'), 'top status bar displays Demo mode');
ok(selectedInspector.includes('DEMO EXECUTION RESULT'), 'selected coin inspector uses Demo execution wording');
ok(settingsPage.includes('Demo trading controls moved to Trade page.'), 'settings page uses Demo wording');
ok(!selectedInspector.includes('PAPER AUTO RESULT'), 'selected coin inspector no longer exposes Paper Auto');
ok(!demoAdapterSrc.includes('PAPER_ORDER_SIMULATION_START') && !demoAdapterSrc.includes('PAPER_ORDER_FILLED'), 'visible runtime adapter logs no longer emit PAPER_ORDER_* names');
ok(demoAdapterSrc.includes('DEMO_ORDER_SIMULATION_START') && demoAdapterSrc.includes('DEMO_ORDER_FILLED'), 'visible runtime adapter logs emit DEMO_ORDER_* names');

console.log(`demo-live-display: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
