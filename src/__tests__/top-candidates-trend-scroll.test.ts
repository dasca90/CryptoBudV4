import { readFileSync } from 'node:fs';
import { mapScannerCandidateToTradeV4View, buildTradeV4PageModel } from '../lib/air-scanner/tradeV4DataAdapter';

let p=0,f=0;
const ok=(c:boolean,m:string)=>{ if(c)p++; else {f++; console.error('FAIL',m);} };

const bullish = mapScannerCandidateToTradeV4View({ symbol:'BULLUSDT', candidateId:'1', status:'WAIT', selectedStrategy:'balanced', confidence:0.7, spreadPct:0.1, volumeRel:1, dipPercent:-1, reboundPercent:0.2, m5Change:0.3, blockReasons:[], mainReason:'x', riskGroup:'top_caps', groupTrend:'sideways', periodTrend:'SIDEWAYS', periodRegime:'range', symbolTrend:'bullish' } as any);
const bearish = mapScannerCandidateToTradeV4View({ symbol:'BEARUSDT', candidateId:'2', status:'WAIT', selectedStrategy:'balanced', confidence:0.7, spreadPct:0.1, volumeRel:1, dipPercent:-1, reboundPercent:0.2, m5Change:0.3, blockReasons:[], mainReason:'x', riskGroup:'top_caps', groupTrend:'bullish', periodTrend:'SIDEWAYS', periodRegime:'range', coinTrend:'bearish' } as any);
const unknown = mapScannerCandidateToTradeV4View({ symbol:'UNKNUSDT', candidateId:'3', status:'WAIT', selectedStrategy:'balanced', confidence:0.7, spreadPct:0.1, volumeRel:1, dipPercent:-1, reboundPercent:0.2, m5Change:0.3, blockReasons:[], mainReason:'x', riskGroup:'top_caps' } as any);

ok(!!bullish.displayTrend?.toLowerCase().includes('bull'), '1 bullish trend uses symbol trend');
ok(!!bearish.displayTrend?.toLowerCase().includes('bear'), '2 bearish trend uses symbol trend before group');
ok((unknown.displayTrend ?? '').toUpperCase().includes('UNKNOWN'), '3 unknown trend does not default to flat');

const model1 = buildTradeV4PageModel({ scannerSnapshot: { scanId:'s1', candidates:[{ symbol:'AUSDT', candidateId:'a', status:'WAIT', selectedStrategy:'balanced', confidence:0.7, spreadPct:0.1, volumeRel:1, dipPercent:-1, reboundPercent:0.2, m5Change:0.3, blockReasons:[], mainReason:'x', riskGroup:'top_caps', symbolTrend:'bullish' } as any], candidateCount:1, buyCount:0, waitCount:1, blockCount:0, avoidCount:0 } as any, positions:[], closedTrades:[], selectedSymbol:null, scannerRunning:true, engineOnline:true, mode:'PAPER', capital:1000, usedCapital:0, pnlToday:0, dataQuality:'GOOD' as any });
const model2 = buildTradeV4PageModel({ scannerSnapshot: { scanId:'s2', candidates:[{ symbol:'AUSDT', candidateId:'a', status:'WAIT', selectedStrategy:'balanced', confidence:0.7, spreadPct:0.1, volumeRel:1, dipPercent:-1, reboundPercent:0.2, m5Change:0.3, blockReasons:[], mainReason:'x', riskGroup:'top_caps', symbolTrend:'bearish' } as any], candidateCount:1, buyCount:0, waitCount:1, blockCount:0, avoidCount:0 } as any, positions:[], closedTrades:[], selectedSymbol:null, scannerRunning:true, engineOnline:true, mode:'PAPER', capital:1000, usedCapital:0, pnlToday:0, dataQuality:'GOOD' as any });
ok(model1.candidates[0].displayTrend !== model2.candidates[0].displayTrend, '4 trend refresh updates between cycles');

const panel = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx','utf8');
ok(panel.includes('table-scroll-both') && panel.includes('minWidth: 1280'), '5 top candidates has horizontal scroll container and wide table');
ok(panel.includes('displayTrend || c.groupTrend || c.periodTrend'), '6 panel uses resolved displayTrend source priority');

const adapterSrc = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts','utf8');
ok(adapterSrc.includes('TOP_CANDIDATE_TREND_SOURCE_AUDIT'), '7 trend source audit log exists');
ok(adapterSrc.includes('TOP_CANDIDATE_TREND_REFRESH_AUDIT'), '8 trend refresh audit log exists');
ok(adapterSrc.includes('TOP_CANDIDATE_TREND_FLAT_FALLBACK_WARNING'), '9 flat fallback warning log exists');

console.log(`top-candidates-trend-scroll: ${p} passed, ${f} failed`);
if(f>0) process.exit(1);
