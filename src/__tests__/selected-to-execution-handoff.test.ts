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
ok(scannerSrc.includes("const blockReason = !this.paperAutoEnabled"), 'paper path computes explicit blocker before adapter handoff');
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
ok(scannerSrc.includes('ACTIVE_SCANNER_INSTANCE_AUDIT'), 'MarketScanner emits active scanner instance audit');
ok(scannerSrc.includes('SELECTED_TO_EXECUTION_HANDOFF_MISSING_FATAL'), 'MarketScanner emits fatal audit if selected handoff audit disappears');
ok(scannerSrc.includes('paper_auto_buy_fn_missing'), 'MarketScanner uses explicit paper_auto_buy_fn_missing blocker');
ok(scannerSrc.includes("const MARKET_SCANNER_LOG_SINK_NAME = 'logger.getLogs/logger.export'"), 'MarketScanner declares the shared UI log sink name');
ok(!scannerSrc.includes('DEMO_EXECUTION_ADAPTER_CALLED: symbol=${sc.symbol} scanId=${scanId}'), 'scanner no longer claims adapter was called before TradingEngine runs');
ok(engineSrc.includes('this.installDefaultPaperAutoBuyHandler();'), 'TradingEngine installs default paper auto buy handler at construction');
ok(engineSrc.includes('DEFAULT_PAPER_AUTO_BUY_HANDLER_INSTALLED'), 'default paper auto buy handler emits wiring audit');
ok(engineSrc.includes('source=TradingEngine.defaultPaperAutoBuyFn'), 'default handler routes selected scanner buys through TradingEngine');
ok(engineSrc.includes('ACTIVE_RUNTIME_SCANNER_WIRING_AUDIT'), 'TradingEngine logs active runtime scanner wiring against the exact scanner instance');

ok(appSrc.includes('scanner.setPaperAutoEnabled(settings.paperAutoExecutionEnabled ?? false)'), 'boot applies persisted paperAutoExecutionEnabled to scanner runtime');
ok(appSrc.includes('autoRuntime.getScanner().setPaperAutoEnabled(true)'), 'scanner start applies persisted paperAutoExecutionEnabled to scanner runtime, preferring live state over stale settings');
ok(appSrc.includes('SCANNER_LIVE_AUTO_STATE_MISMATCH'), 'scanner start audits mismatch between live and persisted auto state');
ok(appSrc.includes('SCANNER_AUTO_STATE_KEEP_LIVE'), 'scanner start logs when live state is preserved over stale persisted');
ok(appSrc.includes('APP_SCANNER_WIRING_AUDIT'), 'App traces the active scanner instance and callback wiring in the shared log sink');

if (failed > 0) {
  console.error(`selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`selected-to-execution-handoff: ${passed} passed, ${failed} failed`);
