import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

ok(scannerSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_AUDIT'), 'MarketScanner emits selected-to-execution handoff audit');
ok(scannerSrc.includes('transactionAuditSymbols.push(sc.symbol)'), 'MarketScanner records symbols handed to TradingEngine transaction path');
ok(scannerSrc.includes('recordPreAdapterBlocker(sc.symbol, blockReason)'), 'paper selected candidates with disabled/missing controller get explicit pre-adapter blocker');
ok(scannerSrc.includes('adapterCalled=false explicitBlocker='), 'pre-adapter blockers log adapterCalled=false with explicitBlocker');
ok(scannerSrc.includes('Demo execution controller unavailable - missing buy function'), 'missing demo buy function is an explicit blocker');
ok(scannerSrc.includes('Demo execution disabled'), 'disabled demo execution is an explicit blocker');
ok(scannerSrc.includes('controllerReceivedSymbols=${attemptedSymbols.join'), 'audit exposes controllerReceivedSymbols');
ok(scannerSrc.includes('transactionAuditCount=${transactionAuditSymbols.length}'), 'audit exposes transactionAuditCount');
ok(scannerSrc.includes('missingAuditSymbols=${missingAuditSymbols.join'), 'audit exposes missingAuditSymbols');
ok(scannerSrc.includes("emitSelectedToExecutionHandoffAudit('post_planner_pre_routing')"), 'handoff audit emits immediately after planner before routing');
ok(scannerSrc.includes('paperAutoExecutionEnabled=${String(this.paperAutoEnabled)}'), 'handoff audit exposes paperAutoExecutionEnabled');
ok(scannerSrc.includes('paperAutoBuyFnPresent=${String(!!this.paperAutoBuyFn)}'), 'handoff audit exposes paperAutoBuyFnPresent');
ok(scannerSrc.includes('executionMode=${executionPlan.executionAdapter}'), 'handoff audit exposes executionMode');
ok(scannerSrc.includes('routeBranch=${routeBranch}'), 'handoff audit exposes routeBranch');
ok(scannerSrc.includes('invariantOk=${String(invariantOk)}'), 'handoff audit exposes invariantOk');
ok(scannerSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_ERROR'), 'handoff emits an error when selected symbols are missing from all buckets');
ok(!scannerSrc.includes('DEMO_EXECUTION_ADAPTER_CALLED: symbol=${sc.symbol} scanId=${scanId}'), 'scanner no longer claims adapter was called before TradingEngine runs');
ok(engineSrc.includes('this.installDefaultPaperAutoBuyHandler();'), 'TradingEngine installs default paper auto buy handler at construction');
ok(engineSrc.includes('DEFAULT_PAPER_AUTO_BUY_HANDLER_INSTALLED'), 'default paper auto buy handler emits wiring audit');
ok(engineSrc.includes('source=TradingEngine.defaultPaperAutoBuyFn'), 'default handler routes selected scanner buys through TradingEngine');

ok(appSrc.includes('scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? false)'), 'boot applies persisted paperAutoExecutionEnabled to scanner runtime');
ok(appSrc.includes('autoRuntime.getScanner().setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? false)'), 'scanner start reapplies persisted paperAutoExecutionEnabled');

if (failed > 0) {
  console.error(`selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
