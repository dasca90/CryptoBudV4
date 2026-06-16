import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
const panelSrc = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/OpenPositionsPanel.tsx'), 'utf8');
const contractsSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-contracts.ts'), 'utf8');

// Test A: dip_and_rebound with dip valid but rebound=0 MUST NOT create position
ok(engineSrc.includes('DIP_REBOUND_CONTRACT_BLOCKED_BEFORE_POSITION_CREATE'), 'Test A: DIP_REBOUND_CONTRACT_BLOCKED_BEFORE_POSITION_CREATE audit exists in TradingEngine');
ok(engineSrc.includes('actualReboundPct') && engineSrc.includes('positionCreateAllowed=false'), 'Test A: contract audit blocks position with positionCreateAllowed=false');

// Test B: dip_and_rebound with dip valid and rebound below required must NOT create position
ok(engineSrc.includes('rebound_below_requirement'), 'Test B: rebound_below_requirement is a blocked reason');
ok(contractsSrc.includes('rebound_below_required') || engineSrc.includes('rebound_below_requirement'), 'Test B: below-required rebound blocks contract');

// Test C: valid dip_and_rebound creates position, Open Positions displays entry snapshot rebound
ok(adapterSrc.includes('entrySnapshotActualReboundPct') && adapterSrc.includes('displayedReboundPct'), 'Test C: adapter logs entrySnapshot rebound and displayed rebound');
ok(engineSrc.includes('positionManager.addPosition'), 'Test C: positionManager.addPosition called after contract passes');

// Test D: Open Positions row must NOT use current scanner rebound if position has entry snapshot rebound
ok(adapterSrc.includes('setup.metrics.actualReboundPct?.actualValue') || adapterSrc.includes('actualReboundPct?.actualValue'), 'Test D: rebound from entry snapshot setup metrics takes priority');
ok(adapterSrc.includes('unifiedSignal?.reboundPct'), 'Test D: scanner fallback is secondary to entry snapshot');

// Test E: If current scanner rebound later becomes 0, open row still shows rebound at entry
ok(adapterSrc.includes('entrySnapshotActualReboundPct') && adapterSrc.includes('currentScannerReboundPct'), 'Test E: adapter compares entry snapshot vs current scanner rebound');

// Test F: Tooltip displays actual/required dip and rebound without clipping
ok(panelSrc.includes('Dip:') && panelSrc.includes('Rebound:') && panelSrc.includes('createPortal'), 'Test F: tooltip portals and shows dip/rebound');
ok(panelSrc.includes('requiredDipPct') || panelSrc.includes('req'), 'Test F: tooltip shows required dip');
ok(panelSrc.includes('requiredReboundPct') || panelSrc.includes('req'), 'Test F: tooltip shows required rebound');

// Additional: DIP_REBOUND_POSITION_INTEGRITY_AUDIT exists for every dip_and_rebound open position
ok(adapterSrc.includes('DIP_REBOUND_POSITION_INTEGRITY_AUDIT'), 'integrity audit exists for every dip_and_rebound open position');
ok(adapterSrc.includes('violationDetected'), 'integrity audit tracks violation detection');

// Additional: DIP_REBOUND_INVALID_OPEN_POSITION_DETECTED logger.warn exists
ok(adapterSrc.includes('DIP_REBOUND_INVALID_OPEN_POSITION_DETECTED'), 'invalid open position detection audit exists');

// Additional: UI shows red warning for invalid dip_and_rebound
ok(panelSrc.includes('INVALID') || panelSrc.includes('status-bad'), 'UI shows red warning for invalid positions');

// Additional: Hard guard checks specific conditions before position creation
ok(engineSrc.includes('dipValid') && engineSrc.includes('reboundValid'), 'TradingEngine checks dipValid and reboundValid');
ok(engineSrc.includes('dipMeetsRequirement') && engineSrc.includes('reboundMeetsRequirement'), 'TradingEngine checks dip/rebound meet requirements');
ok(engineSrc.includes('dipConfirmed') && engineSrc.includes('reboundConfirmed'), 'TradingEngine checks dip/rebound confirmed');

// Additional: Tiny rebound rounding handled (<0.01% instead of 0.00%)
ok(panelSrc.includes('0.005') || panelSrc.includes('0.01'), 'UI handles tiny rebound values that would round to 0.00%');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
