import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const contractsSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-contracts.ts'), 'utf8');
const builderSrc = readFileSync(path.resolve(process.cwd(), 'src/core/strategy-audit/strategy-audit-builder.ts'), 'utf8');
const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. strategy-contracts.ts exists with all 4 strategies
ok(contractsSrc.includes("momentum: {") && contractsSrc.includes("balanced: {") && contractsSrc.includes("dip_and_rebound: {") && contractsSrc.includes("conservative: {"), 'contracts defines all 4 executable strategies');

// 2. Dip/rebound requirements per strategy
ok(contractsSrc.includes("dip_and_rebound") && contractsSrc.includes("dip: 'required'"), 'dip_and_rebound has required dip');
ok(contractsSrc.includes("dip_and_rebound") && contractsSrc.includes("rebound: 'required'"), 'dip_and_rebound has required rebound');
ok(contractsSrc.includes("momentum") && contractsSrc.includes("dip: 'advisory'"), 'momentum has advisory dip');
ok(contractsSrc.includes("balanced") && contractsSrc.includes("dip: 'advisory'"), 'balanced has advisory dip');

// 3. Dynamic thresholds
ok(contractsSrc.includes('dynamicDipThresholds') && contractsSrc.includes('bullish_selective'), 'contracts have dynamic dip thresholds');
ok(contractsSrc.includes('dynamicReboundThresholds'), 'contracts have dynamic rebound thresholds');

// 4. Builder uses validateStrategyContract
ok(builderSrc.includes('validateStrategyContract'), 'builder uses contract validation');
ok(builderSrc.includes('STRATEGY_CONTRACT_VALIDATION_AUDIT'), 'builder emits contract validation audit');
ok(builderSrc.includes('validatorStage=builder') || builderSrc.includes('validatorStage=builder_resolution'), 'builder marks validator stage');

// 5. TradingEngine blocks invalid contract
ok(engineSrc.includes('STRATEGY_CONTRACT_INVALID_BLOCKED'), 'engine blocks invalid strategy contract');
ok(engineSrc.includes('positionCreateAllowed=false'), 'contract invalid blocks position creation');

// 6. requiredDipCanBeNA / requiredReboundCanBeNA
ok(contractsSrc.includes('requiredDipCanBeNA'), 'contracts define requiredDipCanBeNA');
ok(contractsSrc.includes('requiredReboundCanBeNA'), 'contracts define requiredReboundCanBeNA');

// 7. observedOnlyAccepted
ok(contractsSrc.includes('observedOnlyAccepted'), 'contracts define observedOnlyAccepted');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
