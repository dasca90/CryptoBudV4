import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. OPEN_POSITION_DIP_REBOUND_SOURCE_AUDIT exists
ok(adapterSrc.includes('OPEN_POSITION_DIP_REBOUND_SOURCE_AUDIT'), 'tradeV4DataAdapter emits dip/rebound source audit');

// 2. Source tracing
ok(adapterSrc.includes('dipDisplaySource=${dipDisplaySource}'), 'audit exposes dipDisplaySource');
ok(adapterSrc.includes('reboundDisplaySource=${reboundDisplaySource}'), 'audit exposes reboundDisplaySource');

// 3. Entry snapshot vs displayed comparison
ok(adapterSrc.includes('entrySnapshotDipPct=${entrySnapshotDipPct'), 'audit exposes entrySnapshotDipPct');
ok(adapterSrc.includes('entrySnapshotReboundPct=${entrySnapshotReboundPct'), 'audit exposes entrySnapshotReboundPct');

// 4. Current scanner values
ok(adapterSrc.includes('currentScannerDipPct=${String(unifiedSignal?.dipPercent'), 'audit exposes currentScannerDipPct');
ok(adapterSrc.includes('currentScannerReboundPct=${String(unifiedSignal?.reboundPct'), 'audit exposes currentScannerReboundPct');

// 5. Required thresholds
ok(adapterSrc.includes('requiredDipPctAtEntry=${requiredDipPctAtEntry'), 'audit exposes requiredDipPctAtEntry');
ok(adapterSrc.includes('requiredReboundPctAtEntry=${requiredReboundPctAtEntry'), 'audit exposes requiredReboundPctAtEntry');

// 6. Mismatch detection
ok(adapterSrc.includes('mismatchDetected=${String(mismatchDetected)}'), 'audit detects mismatch');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
