import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. RISK_GROUP_POSITION_LIMIT_AUDIT exists
ok(engineSrc.includes('RISK_GROUP_POSITION_LIMIT_AUDIT'), 'TradingEngine emits risk group position limit audit');

// 2. Audit fields
ok(engineSrc.includes('currentOpenPositionsInGroup=${groupExposuresSnapshot?.currentPositions'), 'audit exposes currentOpenPositionsInGroup');
ok(engineSrc.includes('maxOpenPositionsInGroup=${maxGroupPos}'), 'audit exposes maxOpenPositionsInGroup');
ok(engineSrc.includes('wouldExceedGroupLimit='), 'audit exposes wouldExceedGroupLimit');
ok(engineSrc.includes('blockReason=${preAdapterRiskDecision.blockReasons'), 'audit exposes blockReason');
ok(engineSrc.includes('sourceOfLimit=RiskEngine'), 'audit exposes sourceOfLimit');
ok(engineSrc.includes('positionManagerOpenCount='), 'audit exposes positionManagerOpenCount');

// 3. Last risk block reason stored and propagated
ok(engineSrc.includes('this.lastRiskBlockReason = String(preAdapterRiskDecision'), 'engine stores last risk block reason');
ok(engineSrc.includes('getLastRiskBlockReason'), 'engine exposes getLastRiskBlockReason');

// 4. Fail reason includes risk block detail
ok(engineSrc.includes('risk_blocked:') && engineSrc.includes('lastRiskBlockReason'), 'fail reason includes risk_blocked prefix');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
