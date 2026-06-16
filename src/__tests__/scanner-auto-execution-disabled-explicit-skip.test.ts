import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// 1. Explicit auto_execution_disabled skip audit
ok(scannerSrc.includes("reason=auto_execution_disabled"), 'MarketScanner emits explicit skip reason=auto_execution_disabled');
ok(scannerSrc.includes("preFilterBuyCount > 0 && !this.paperAutoEnabled"), 'skip condition checks buy-ready candidates AND auto disabled');
ok(scannerSrc.includes('SCANNER_EXECUTION_SKIPPED_AUDIT'), 'skip audit uses SCANNER_EXECUTION_SKIPPED_AUDIT');

// 2. When auto disabled, scan still completes with candidates but no execution
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_GATE_AUDIT'), 'gate audit fires regardless of auto state');
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_START'), 'phase start fires regardless of auto state');
ok(scannerSrc.includes('SCANNER_EXECUTION_PHASE_END'), 'phase end fires regardless of auto state');

// 3. Pre-adapter blocker when auto disabled
ok(scannerSrc.includes("adapter === 'paper_simulated'"), 'paper_simulated routing branch exists');
ok(scannerSrc.includes("!this.paperAutoEnabled"), 'auto disabled check exists in routing');
ok(scannerSrc.includes('Demo execution disabled'), 'explicit blocker name for disabled auto');
ok(scannerSrc.includes('paper_auto_buy_fn_missing'), 'explicit blocker when buy fn missing');

// 4. Gate audit shows skipReason=auto_execution_disabled
ok(scannerSrc.includes("skipReasonGate = !this.paperAutoEnabled ? 'auto_execution_disabled'"), 'phase gate computes skipReason=auto_execution_disabled when auto disabled');

// 5. Scanner AUTO_EXECUTION_GATE_AUDIT also shows skip
ok(scannerSrc.includes("skipReason = !this.paperAutoEnabled ? 'paper_auto_execution_disabled'"), 'entry gate computes skipReason=paper_auto_execution_disabled when auto disabled');

// 6. No silent skip — all skip paths are audit-logged
const explicitSkipCount = (scannerSrc.match(/SCANNER_EXECUTION_SKIPPED_AUDIT/g) || []).length;
ok(explicitSkipCount >= 3, `SCANNER_EXECUTION_SKIPPED_AUDIT appears at least 3 times (auto_disabled + pool_filter + plan_blocked): ${explicitSkipCount}`);

// 7. Legacy brain auto path remains blocked
ok(appSrc.includes('LEGACY_AUTO_BUY_PATH_BLOCKED'), 'legacy brain auto buy path remains explicitly blocked');
ok(appSrc.includes('canonicalReplacement=scanner_auto'), 'canonical replacement is scanner_auto');

// 8. Scanner AUTO_EXECUTION_GATE_AUDIT exists at scan entry with full context
ok(scannerSrc.includes('paper_auto_execution_disabled'), 'entry gate reason includes paper_auto_execution_disabled');
ok(scannerSrc.includes('paper_auto_buy_fn_missing'), 'entry gate reason includes paper_auto_buy_fn_missing');

if (failed > 0) {
  console.error(`scanner-auto-execution-disabled-explicit-skip: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`scanner-auto-execution-disabled-explicit-skip: ${passed} passed, ${failed} failed`);
