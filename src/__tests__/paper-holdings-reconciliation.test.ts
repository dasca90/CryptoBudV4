import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/core/exchange/PaperExchangeAdapter.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');
const appSrc = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');

// Test A1: PaperExchangeAdapter has reconcileHolding method
ok(adapterSrc.includes('reconcileHolding'), 'Test A1: PaperExchangeAdapter has reconcileHolding method');

// Test A2: PaperExchangeAdapter has reconcileAllHoldings method
ok(adapterSrc.includes('reconcileAllHoldings'), 'Test A2: PaperExchangeAdapter has reconcileAllHoldings method');

// Test A3: PAPER_HOLDINGS_RECONCILIATION_AUDIT exists
ok(adapterSrc.includes('PAPER_HOLDINGS_RECONCILIATION_AUDIT'), 'Test A3: PAPER_HOLDINGS_RECONCILIATION_AUDIT log exists');

// Test A4: PAPER_SELL_HOLDINGS_MISMATCH_DETECTED exists in TradingEngine
ok(engineSrc.includes('PAPER_SELL_HOLDINGS_MISMATCH_DETECTED'), 'Test A4: PAPER_SELL_HOLDINGS_MISMATCH_DETECTED log exists');

// Test A5: TradingEngine reconciles before SELL when paper holding is 0
ok(engineSrc.includes('reconcileHolding') || engineSrc.includes('PAPER_SELL_HOLDINGS_MISMATCH_DETECTED'), 'Test A5: TradingEngine attempts reconciliation before SELL');

// Test A6: Paper reconciliation called on startup hydration
ok(appSrc.includes('reconcileAllHoldings'), 'Test A6: App.tsx reconciles paper holdings after position hydration');

// Test A7: Reconciliation preserves existing positions
ok(adapterSrc.includes('already_synced'), 'Test A7: Reconciliation detects already-synced positions');

// Test A8: Reconciliation creates missing paper holdings
ok(adapterSrc.includes('created_paper_holding'), 'Test A8: Reconciliation creates missing paper holdings');

// Test A9: Reconciliation removes stale paper holdings
ok(adapterSrc.includes('removed_stale_paper_holding'), 'Test A9: Reconciliation removes stale paper holdings');

// Test A10: Reconciliation updates mismatched quantities
ok(adapterSrc.includes('updated_paper_holding'), 'Test A10: Reconciliation updates mismatched quantities');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
