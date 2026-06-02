import { readFileSync } from 'node:fs';
import { buildExecutionPlan } from '../core/scanner/ExecutionPlanner';
import type { ScannerCandidate, ScannerSnapshot, EntryGateOutput } from '../core/types';

let p=0,f=0;
const ok=(c:boolean,m:string)=>{ if(c)p++; else {f++; console.error('FAIL',m);} };

function gateAllow(): EntryGateOutput {
  return { decision:'ALLOW', primaryReason:null, blockReasons:[], warnings:[], explanation:'ok', requiredNextActions:[], snapshot:{ decision:'ALLOW', primaryReason:null, blockReasons:[], requiredNextActions:[], confidenceResult:{status:'PASS',reason:null,pass:true,input:0.8,required:0.3,source:'test'}, spreadSlippageResult:{status:'PASS',reason:null}, priceFreshnessResult:{status:'PASS',reason:null}, tpRoomResult:{status:'PASS',reason:null}, marketSafetyResult:{status:'PASS',reason:null}, exposureCapitalResult:{status:'PASS',reason:null}, duplicateSymbolResult:{status:'PASS',reason:null}, timestamp:new Date().toISOString(), source:'entry_gate_canonical' } } as any;
}

function cand(symbol:string, overrides?: Partial<ScannerCandidate>): ScannerCandidate {
  return {
    candidateId:`c_${symbol}`, symbol, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), mode:'AUTO', riskGroup:'mid_caps', selectedStrategy:'conservative', selectedPlaybook:null,
    confidence:0.8, status:'BUY', traderBrainDecision:{ entryPlan:{ side:'BUY', price:100, quantity:1, reason:'test' }, ruleDecisionTrace:{ unifiedSignal:{ reasonCode:'WAITING_FOR_SETUP', definition:{ buyRule:'conservative' } } } } as any,
    entryGateDecision:gateAllow(), mainReason:'ok', requiredNextActions:[], blockReasons:[], warnings:[], price:100, priceAgeMs:100, spreadPct:0.1, volumeRel:1,
    tpRoomOk:true, reboundConfirmed:true, momentumConfirmed:true, dipPercent:0, reboundPercent:0.2695, m5Change:0.1, m15Change:0.1, h1Change:0.1, change24h:0,
    mlBadEntryRisk:false, mlWinProbability:0.8, bookFresh:true,
    autoStrategyDecision:{ strategySource:'autobots', effectiveStrategy:'conservative', groupTrend:'bullish', groupRecommendedStrategy:'conservative', reason:'x', warnings:[], confidenceTier:'high' } as any,
    tradingTargetOwnership:{ tp1Value:1.2, tp2Value:0, slValue:1.5, dynamicTrailingEnabled:false, trailingStartsAt:'TP1', trailPullbackValue:0.25, tp1Source:'AutoBots dynamic per coin' } as any,
    ...overrides,
  } as any;
}

const snapshot: ScannerSnapshot = { scanId:'s', startedAt:'', finishedAt:'', status:'COOLDOWN', universeMode:'TOP_50', universeSize:1, scannedCount:1, candidateCount:1, buyCount:1, waitCount:0, blockCount:0, avoidCount:0, candidates:[], summary:'', diagnostics:{} as any };

const blockedFinal = cand('ETHUSDT');
const plan1 = buildExecutionPlan({ scannerSnapshot:snapshot, executionPool:[blockedFinal], watchPool:[], nearMissPool:[], openSymbols:[], pendingOrderSymbols:[], capital:1000, usedCapital:0, maxPositions:10, maxEntriesPerCycle:5, capitalPerTrade:100, maxSpreadPct:0.35, decisionMode:'unified', executionAdapter:'paper_simulated', enabledRiskGroups:{mid_caps:true} as any });
ok(plan1.selectedCandidates.length===0, '1 finalExecutable false excluded from execution pool selection');
ok(plan1.noBuyReasons.some(r=>r.includes('strategy_setup_not_met') || r.includes('dip_missing') || r.includes('rebound_missing') || r.includes('finalExecutable_false')), '2 noBuyReasons contains exact final gate blockers');

const tp1Invalid = cand('BANANAS31USDT', { selectedStrategy: 'momentum', tradingTargetOwnership:{ tp1Value:0, tp2Value:0, slValue:1.5, dynamicTrailingEnabled:false, trailingStartsAt:'TP1', trailPullbackValue:0.25, tp1Source:'unknown' } as any });
const plan2 = buildExecutionPlan({ scannerSnapshot:snapshot, executionPool:[tp1Invalid], watchPool:[], nearMissPool:[], openSymbols:[], pendingOrderSymbols:[], capital:1000, usedCapital:0, maxPositions:10, maxEntriesPerCycle:5, capitalPerTrade:100, maxSpreadPct:0.35, decisionMode:'unified', executionAdapter:'paper_simulated', enabledRiskGroups:{mid_caps:true} as any });
ok(plan2.selectedCandidates.length===0, '3 tp1=0 blocked before execution selection');
ok(plan2.noBuyReasons.includes('tp1_missing_or_zero'), '4 tp1 missing reason propagated');

const ownershipMissing = cand('NILUSDT', { selectedStrategy: 'momentum', tradingTargetOwnership: undefined, dipPercent: -3, reboundPercent: 2, m5Change: 1.2 });
const plan3 = buildExecutionPlan({ scannerSnapshot:snapshot, executionPool:[ownershipMissing], watchPool:[], nearMissPool:[], openSymbols:[], pendingOrderSymbols:[], capital:1000, usedCapital:0, maxPositions:10, maxEntriesPerCycle:5, capitalPerTrade:100, maxSpreadPct:0.35, decisionMode:'unified', executionAdapter:'paper_simulated', enabledRiskGroups:{mid_caps:true} as any });
ok(!plan3.noBuyReasons.includes('tp1_missing_or_zero'), '4a missing ownership resolves AutoBots dynamic TP1 instead of silently using zero');

const plannerSrc = readFileSync('src/core/scanner/ExecutionPlanner.ts','utf8');
const scannerSrc = readFileSync('src/core/scanner/MarketScanner.ts','utf8');
const appSrc = readFileSync('src/App.tsx','utf8');
ok(plannerSrc.includes('BUY_READY_FINAL_GATE_AUDIT') && plannerSrc.includes('EXECUTION_POOL_FINAL_FILTER_AUDIT'), '5 planner final gate audit logs exist');
ok(plannerSrc.includes('TRADING_TARGET_OWNERSHIP_FALLBACK_RESOLVED'), '6 planner resolves missing AutoBots target ownership before TP1 gate');
ok(scannerSrc.includes('FINAL_SCAN_NO_BUY_REASON_AUDIT') && scannerSrc.includes('firstSkipReason'), '7 final scan no-buy reason uses real skip reason');
ok(appSrc.includes('POSITION_CREATE_FAILED_REASON_AUDIT') && appSrc.includes('DEMO_EXECUTION_FAILURE_REASON_AUDIT'), '8 app emits explicit execution failure reason logs');

console.log(`buy-ready-final-gate.test: ${p} passed, ${f} failed`);
if(f>0) process.exit(1);
