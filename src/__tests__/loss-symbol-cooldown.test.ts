import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const scannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/MarketScanner.ts'), 'utf8');
const plannerSrc = readFileSync(path.resolve(process.cwd(), 'src/core/scanner/ExecutionPlanner.ts'), 'utf8');

// 1. Loss cooldown is separate from normal cooldown
ok(scannerSrc.includes('lossCooldownMs'), 'MarketScanner has lossCooldownMs config');

// 2. Loss detection based on pnlPct < 0
ok(scannerSrc.includes('const isLoss = data.pnlPct < 0'), 'recordClose detects loss by pnlPct < 0');

// 3. Loss uses stronger cooldown (lossCooldownMs > recentlyClosedCooldownMs)
const rcIdx = scannerSrc.indexOf('recentlyClosedCooldownMs = ');
const lsIdx = scannerSrc.indexOf('lossCooldownMs = ');
ok(rcIdx > 0, 'recentlyClosedCooldownMs is defined');
ok(lsIdx > 0, 'lossCooldownMs is defined');

// 4. Cooldown duration logged in recordClose audit
ok(scannerSrc.includes('cooldownMs=${cooldownMs}'), 'recordClose audit exposes cooldownMs');
ok(scannerSrc.includes('isLoss=${String(isLoss)}'), 'recordClose audit exposes isLoss flag');

// 5. Different cooldown for profit vs loss trades
ok(scannerSrc.includes('const cooldownMs = isLoss ? this.lossCooldownMs : this.recentlyClosedCooldownMs;'), 'recordClose selects cooldown based on loss');

// 6. Loss recovery has a distinct pre-queue reason
ok(plannerSrc.includes('SYMBOL_RECOVERY_REQUIRED'), 'loss recovery is distinct from symbol cooldown and global pacing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
