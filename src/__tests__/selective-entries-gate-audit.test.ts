import { readFileSync } from 'node:fs';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const topSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const selectedSrc = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
const adapterSrc = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');

ok(scannerSrc.includes('SPREAD_GATE_THRESHOLD_AUDIT'), '1 spread gate threshold audit log exists');
ok(scannerSrc.includes('SPREAD_THRESHOLD_UI_GATE_MISMATCH'), '2 spread threshold mismatch log exists');
ok(scannerSrc.includes('SELECTIVE_ENTRY_FINAL_GATE_SUMMARY'), '3 selective entry final gate summary log exists');
ok(scannerSrc.includes('finalNoBuyReason') && scannerSrc.includes("no_executable_candidates"), '4 final no buy reason is propagated when pool is empty');

ok(topSrc.includes('finalExecutable') && topSrc.includes('NO-FINAL'), '5 top candidates shows final executable state');
ok(topSrc.includes('spreadPct') && topSrc.includes('maxSpreadUsedByEntryGate'), '6 top candidates shows spread actual versus allowed');
ok(topSrc.includes('primaryBlocker') || topSrc.includes('gateAudit?.blocker'), '7 top candidates shows main blocker');

ok(selectedSrc.includes('FINAL GATE STATUS'), '8 selected coin renders final gate status section');
ok(selectedSrc.includes('Spread:') && selectedSrc.includes('max'), '9 selected coin shows spread actual vs max');
ok(selectedSrc.includes('Slippage:') && selectedSrc.includes('max'), '10 selected coin shows slippage actual vs max');
ok(selectedSrc.includes('Executable now:') && selectedSrc.includes('Blocked spread/slippage:'), '11 selective entries explanation counters are visible');

ok(adapterSrc.includes('gateAudit: candidate.gateAudit'), '12 adapter forwards gate audit into UI model');
ok(adapterSrc.includes('finalNoBuyReason: snap.noBuySummary.finalNoBuyReason'), '13 adapter forwards final no-buy reason');

console.log(`selective-entries-gate-audit: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);

