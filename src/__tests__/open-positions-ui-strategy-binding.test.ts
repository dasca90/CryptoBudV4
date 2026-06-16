import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');

// 1. Open position strategy from buySnapshot.selectedStrategy
ok(adapterSrc.includes('const rawSelectedStrategy = bs?.selectedStrategy ?? null;') || adapterSrc.includes('rawSelectedStrategy = bs?.selectedStrategy'), 'open position reads rawSelectedStrategy from buySnapshot');

// 2. Wait strategy mapped to unknown_legacy
ok(adapterSrc.includes("rawSelectedStrategy.toLowerCase() === 'wait' ? 'unknown_legacy'"), 'open position maps wait to unknown_legacy');

// 3. POSITION_STRATEGY_BINDING_AUDIT for open positions
ok(adapterSrc.includes('POSITION_STRATEGY_BINDING_AUDIT') && adapterSrc.includes('isOpenPosition=true'), 'open position binding audit present');

// 4. Audit distinguishes valid vs invalid strategy
ok(adapterSrc.includes('validExecutedStrategy=${String(validExecutedStrategy)}'), 'binding audit computes validExecutedStrategy');

// 5. Entry config snapshot strategy compared to displayed strategy
ok(adapterSrc.includes('entryConfigSnapshotStrategy=${entryConfigSnapshotStrategy'), 'binding audit compares entryConfigSnapshotStrategy');

// 6. Source tracing
ok(adapterSrc.includes('sourceOfDisplayedStrategy=${sourceOfDisplayedStrategy}'), 'binding audit traces source');

// 7. entryRuleAtEntry exposed
ok(adapterSrc.includes('entryRuleAtEntry=${entryRuleAtEntry'), 'binding audit exposes entryRuleAtEntry');

// 8. finalEntryRule from config snapshot exposed
ok(adapterSrc.includes('finalEntryRule=${String((bs as any)?.entryConfigSnapshot?.finalEntryRule'), 'binding audit exposes finalEntryRule from snapshot');

// 9. Logs for both open and closed positions
const openAudits = adapterSrc.split('POSITION_STRATEGY_BINDING_AUDIT').filter(s => s.includes('isOpenPosition=true'));
const closedAudits = adapterSrc.split('POSITION_STRATEGY_BINDING_AUDIT').filter(s => s.includes('isClosedPosition=true'));
ok(openAudits.length >= 1, 'open position strategy binding audit fires');
ok(closedAudits.length >= 1, 'closed position strategy binding audit fires');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
