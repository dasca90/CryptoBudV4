import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PositionManager } from '../core/positions/PositionManager';
import { buildTradeV4PageModel, mapTradeRecordToClosedPositionView } from '../lib/air-scanner/tradeV4DataAdapter';
import type { Position, TradeRecord } from '../core/types';
import { logger } from '../utils/logger';
import { OPEN_POSITION_COLUMNS, OPEN_POSITION_DETAILED_COLUMNS } from '../components/trade-v4/openPositionsPanelModel';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function makeBaseOpenPosition(symbol: string, strategy: string, openedAt?: number): Position {
  return {
    coin: symbol,
    quantity: 10,
    avgEntryPrice: 1.5,
    currentPrice: 1.6,
    pnl: 1,
    pnlPercent: 6.66,
    unrealizedPnlPercent: 6.66,
    mode: 'AUTO',
    openedAt: openedAt ?? Date.now() - 5000,
    highestPrice: 1.62,
    highestPriceSinceTp: 1.62,
    tpArmed: false,
    tp1Hit: false,
    tp2Hit: false,
    stopLossPercent: 1.5,
    tp1Percent: 2,
    tp2Percent: 0,
    trailFromPeakPercent: 0.25,
    maxHoldSec: 3600,
    tpMode: 'fixed',
    tpTriggerType: 'percent',
    tradeId: `trade_${symbol}`,
    ownerType: 'scanner',
    buySnapshot: {
      selectedStrategy: strategy,
      selectedPlaybook: `${strategy}_entry_rule`,
      whySelectedOverOthers: `${strategy} short why`,
      riskGroup: 'mid_caps',
      groupRegime: 'bullish',
      mode: 'AUTO',
      entryPriceSource: 'book_ticker',
      entryPriceAgeMs: 900,
      spreadPct: 0.12,
      confidence: 0.82,
      referencePeriod: '1h',
      candidateRank: 7,
      source: 'scanner',
      settingsSnapshot: {
        maxSlippagePct: 0.25,
        maxTotalEntryCostPct: 0.6,
        entryConfirmationMode: 'smart',
        strategySource: 'autobots',
      },
      traderBrainDecision: {
        selectedPlaybook: `${strategy}_entry_rule`,
        ruleDecisionTrace: {
          unifiedSignal: {
            dipPercent: -1.11,
            reboundPct: 0.33,
            reboundPassed: true,
            momentumConfirmed: true,
            reasonCode: `${strategy}_reason_code`,
          },
        },
      },
      entryConfigSnapshot: {
        riskParams: {
          tp1Pct: 1.7,
          tp1TargetPrice: 1.5255,
          tp1Source: 'AutoBots dynamic per coin',
          sourceTp1: 'AutoBots dynamic per coin',
          tp2Pct: 0,
          tp2Source: 'autobots_enforced_zero',
          sourceTp2: 'autobots_enforced_zero',
          slPct: 1.5,
          slSource: 'user',
          sourceSl: 'user',
        },
        strategyAuditSnapshot: {
          finalEntryRule: `${strategy}_entry_rule`,
          entryReason: `${strategy} short why`,
          finalExecutable: true,
          setupMissing: false,
          setupPassed: true,
          setupMetrics: [],
        },
      },
    } as any,
  } as Position;
}

function setSetupMetrics(position: Position, metrics: any[], overrides?: { finalExecutable?: boolean; entryReason?: string }) {
  const snap = (position.buySnapshot as any).entryConfigSnapshot.strategyAuditSnapshot;
  snap.setupMetrics = metrics;
  if (overrides?.finalExecutable !== undefined) snap.finalExecutable = overrides.finalExecutable;
  if (overrides?.entryReason) snap.entryReason = overrides.entryReason;
}

function makeClosedTrade(symbol = 'OLDUSDT'): TradeRecord {
  return {
    tradeId: `closed_${symbol}`,
    coin: symbol,
    mode: 'AUTO',
    side: 'SELL',
    adapter: 'Demo',
    entryPrice: 1,
    exitPrice: 1.1,
    quantity: 10,
    pnl: 1,
    pnlPercent: 10,
    entryTime: new Date().toISOString(),
    exitTime: new Date().toISOString(),
    status: 'closed',
    strategy: 'momentum',
    buySnapshot: {
      mode: 'AUTO',
      confidence: 0.8,
      candidateRank: 5,
      riskGroup: 'mid_caps',
      traderBrainDecision: { selectedPlaybook: 'momentum' },
      settingsSnapshot: { tp1Pct: 2, tp2Pct: 4 },
    } as any,
    closeSnapshot: {
      exitReason: 'TP1_FIXED',
      fees: 0.01,
      executionQuality: 'CLEAN_REAL_MARKET_PRICE',
      closePriceSource: 'book_ticker',
      tp1Percent: 2,
      tp2Percent: 4,
      stopLossPercent: 1.5,
      durationMs: 120000,
    } as any,
  } as TradeRecord;
}

function makeLegacyClosedTrade(symbol = 'LEGOLDUSDT'): TradeRecord {
  const trade = makeClosedTrade(symbol);
  trade.entryTime = '2025-05-01T00:00:00.000Z';
  trade.exitTime = '2025-05-01T00:10:00.000Z';
  delete (trade as any).buySnapshot;
  return trade;
}

function main() {
  logger.clear();
  const pm = new PositionManager();

  const conservative = makeBaseOpenPosition('CONSUSDT', 'conservative');
  setSetupMetrics(conservative, [
    { key: 'actualDipPct', actualValue: -2.1, requiredValue: -2.0, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredDipPct', actualValue: -2.0, requiredValue: -2.0, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'buy-rule-matrix' },
    { key: 'actualReboundPct', actualValue: 1.1, requiredValue: 1.0, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'autobots-selector' },
    { key: 'requiredReboundPct', actualValue: 1.0, requiredValue: 1.0, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'autobots-selector' },
    { key: 'momentumConfirmed', actualValue: true, requiredValue: true, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
    { key: 'safetyScoreActual', actualValue: 87, requiredValue: 70, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' },
    { key: 'safetyScoreRequired', actualValue: 70, requiredValue: 70, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' },
  ], { finalExecutable: true, entryReason: 'conservative short why' });

  const balanced = makeBaseOpenPosition('BALUSDT', 'balanced');
  setSetupMetrics(balanced, [
    { key: 'actualReboundPct', actualValue: 0.12, requiredValue: 0.25, passed: false, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
    { key: 'requiredReboundPct', actualValue: 0.25, requiredValue: 0.25, passed: false, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
    { key: 'momentumConfirmed', actualValue: false, requiredValue: true, passed: false, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
  ], { finalExecutable: false, entryReason: 'balanced short why' });
  (balanced.buySnapshot as any).traderBrainDecision.ruleDecisionTrace.unifiedSignal.reboundPassed = false;

  const dipRebound = makeBaseOpenPosition('DRUSDT', 'dip_and_rebound');
  setSetupMetrics(dipRebound, [
    { key: 'actualDipPct', actualValue: -1.9, requiredValue: -1.2, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'buy-rule-matrix' },
    { key: 'requiredDipPct', actualValue: -1.2, requiredValue: -1.2, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'buy-rule-matrix' },
    { key: 'actualReboundPct', actualValue: 0.35, requiredValue: 0.2, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
    { key: 'requiredReboundPct', actualValue: 0.2, requiredValue: 0.2, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
    { key: 'momentumConfirmed', actualValue: true, requiredValue: true, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
  ], { finalExecutable: true, entryReason: 'dip/rebound short why' });
  (dipRebound.buySnapshot as any).traderBrainDecision.ruleDecisionTrace.unifiedSignal.reboundPassed = true;

  const momentum = makeBaseOpenPosition('MOMUSDT', 'momentum');
  setSetupMetrics(momentum, [
    { key: 'actualDipPct', actualValue: -0.4, requiredValue: -0.8, passed: false, usedByStrategy: false, role: 'advisory', sourceLayer: 'legacy' },
    { key: 'requiredDipPct', actualValue: -0.8, requiredValue: -0.8, passed: false, usedByStrategy: false, role: 'unused', sourceLayer: 'legacy' },
    { key: 'actualReboundPct', actualValue: 0.41, requiredValue: 0.2, passed: true, usedByStrategy: false, role: 'unused', sourceLayer: 'legacy' },
    { key: 'requiredReboundPct', actualValue: 0.2, requiredValue: 0.2, passed: true, usedByStrategy: false, role: 'advisory', sourceLayer: 'legacy' },
    { key: 'momentumConfirmed', actualValue: true, requiredValue: true, passed: true, usedByStrategy: true, role: 'required', sourceLayer: 'entry-gate' },
  ], { finalExecutable: true, entryReason: 'momentum short why' });

  const legacyNoSnapshot = makeBaseOpenPosition('LEGACYUSDT', 'legacy', Date.parse('2025-05-01T00:00:00.000Z'));
  (legacyNoSnapshot as any).buySnapshot = undefined;

  const missingSetupNew = makeBaseOpenPosition('MISSUSDT', 'balanced');
  (missingSetupNew.buySnapshot as any).createdAt = new Date().toISOString();
  ((missingSetupNew.buySnapshot as any).entryConfigSnapshot.strategyAuditSnapshot.setupMetrics as any[]) = [];
  (missingSetupNew.buySnapshot as any).traderBrainDecision.ruleDecisionTrace = {};

  const missingRiskNew = makeBaseOpenPosition('BUGRISKUSDT', 'balanced');
  delete (missingRiskNew.buySnapshot as any).entryConfigSnapshot;
  (missingRiskNew.buySnapshot as any).settingsSnapshot = { stopLossPercent: 1.5, tp1Pct: 0, tp2Pct: 0, strategySource: 'autobots' };

  const invalidTp1New = makeBaseOpenPosition('BADTP1USDT', 'conservative');
  ((invalidTp1New.buySnapshot as any).entryConfigSnapshot.riskParams as any).tp1Pct = 0;
  ((invalidTp1New.buySnapshot as any).entryConfigSnapshot.riskParams as any).tp1TargetPrice = invalidTp1New.avgEntryPrice;
  ((invalidTp1New.buySnapshot as any).entryConfigSnapshot.riskParams as any).autoBotsOnAtEntry = true;

  [conservative, balanced, dipRebound, momentum, legacyNoSnapshot, missingSetupNew, missingRiskNew, invalidTp1New].forEach((p) => pm.addPosition(p.coin, p));

  const open = pm.getOpenPositions();
  const exposure = pm.getExposureSummary();
  const model = buildTradeV4PageModel({
    scannerSnapshot: null,
    positions: open,
    closedTrades: [makeClosedTrade()],
    selectedSymbol: 'CONSUSDT',
    scannerRunning: true,
    engineOnline: true,
    mode: 'PAPER',
    capital: 1000,
    usedCapital: exposure.totalExposure,
    pnlToday: 0,
    dataQuality: 'GOOD',
    storeOpenPositionsCount: open.length,
    positionManagerOpenCount: open.length,
    headerPositionsCount: open.length,
    openPanelRowsCount: open.length,
    activeMode: 'AUTO',
  });

  const bySymbol = (s: string) => model.openPositions.find((r) => r.symbol === s)!;
  const cons = bySymbol('CONSUSDT');
  const bal = bySymbol('BALUSDT');
  const dr = bySymbol('DRUSDT');
  const mom = bySymbol('MOMUSDT');
  const legacy = bySymbol('LEGACYUSDT');
  const missingSetup = bySymbol('MISSUSDT');
  const bugRisk = bySymbol('BUGRISKUSDT');
  const badTp1 = bySymbol('BADTP1USDT');

  ok((cons.strategySetupDipReqLabel ?? '').includes('2.10%'), '1 conservative shows actual dip');
  ok((cons.strategySetupReboundReqLabel ?? '').includes('1.10%'), '2 conservative shows actual rebound');
  ok((cons.strategySetupDipReqLabel ?? '').includes('required') && (cons.strategySetupReboundReqLabel ?? '').includes('required'), '3 conservative role required according to metrics');
  ok((cons.strategySetupMetrics as any).safetyScoreActual?.actualValue === 87 && (cons.strategySetupMetrics as any).safetyScoreRequired?.requiredValue === 70, '4 conservative shows safety score actual/required');
  ok((bal.strategySetupReboundReqLabel ?? '').includes('0.12%'), '5 balanced shows rebound actual');
  ok((bal.strategySetupReboundReqLabel ?? '').includes('0.25%'), '6 balanced shows rebound required');
  ok(bal.reboundConfirmed === false, '7 balanced shows rebound failed');
  ok((dr.strategySetupDipReqLabel ?? '').includes('1.90%') && (dr.strategySetupDipReqLabel ?? '').includes('1.20%'), '8 dip-and-rebound shows actual/required dip');
  ok((dr.strategySetupReboundReqLabel ?? '').includes('0.35%') && (dr.strategySetupReboundReqLabel ?? '').includes('0.20%'), '9 dip-and-rebound shows actual/required rebound');
  ok(dr.reboundConfirmed === true && bal.reboundConfirmed === false, '10 dip-and-rebound shows reboundConfirmed true/false');
  ok(mom.momentumConfirmed === true, '11 momentum shows momentumConfirmed');
  ok((mom.strategySetupDipReqLabel ?? '').toLowerCase().includes('entry snapshot') && (mom.strategySetupReboundReqLabel ?? '').toLowerCase().includes('entry snapshot'), '12 momentum dip/rebound shown from entry snapshot, not live observed state');
  ok(typeof cons.strategySetupResult === 'string' && cons.strategySetupResult.length > 0, '13 open row shows setupResult');
  ok((cons.strategySetupWhy ?? '').toLowerCase().includes('short why'), '14 open row shows WHY/entry reason');

  const panelPath = path.resolve(process.cwd(), 'src/components/trade-v4/OpenPositionsPanel.tsx');
  const panelSource = readFileSync(panelPath, 'utf8');
  ok(JSON.stringify(OPEN_POSITION_COLUMNS) === JSON.stringify(['Symbol','State','Strategy','Trend','Qty','Entry Value','Entry Fee $','Est. Exit Fee $','Dip','Rebound','PnL%','Unrealized','Risk','TP1 (%)','TP2 (%)','Stop (%)','Entry','Ref','Last','Stop Trigger','Decision','Owner','Opened At','Hold']), '15 V4 open default column order exactly');
  ok(OPEN_POSITION_DETAILED_COLUMNS.includes('Setup Result') && OPEN_POSITION_DETAILED_COLUMNS.includes('Why') && OPEN_POSITION_DETAILED_COLUMNS.includes('Rebound/Req'), '15a setup/debug columns exist only in detailed column group');
  const modelSource = readFileSync(path.resolve(process.cwd(), 'src/components/trade-v4/openPositionsPanelModel.ts'), 'utf8');
  const defaultColumnBlock = modelSource.slice(modelSource.indexOf('export const OPEN_POSITION_COLUMNS'), modelSource.indexOf('export const OPEN_POSITION_DETAILED_COLUMNS'));
  ok(!defaultColumnBlock.includes('Setup Result') && !defaultColumnBlock.includes('Why') && !defaultColumnBlock.includes('Rebound/Req') && !defaultColumnBlock.includes('Mom'), '15b default V4 open columns do not include debug/setup junk');
  ok(panelSource.includes('v3-positions-window') && panelSource.includes('v3-scrollbar-strip') && panelSource.includes('Open Positions'), '15c open panel uses V3 visual shell/title/scroll strip');
  ok(panelSource.includes('OPEN_POSITION_UI_CELL_AUDIT') && panelSource.includes('BUG: TP1 INVALID'), '15d OpenPositionsPanel audits TP1 cell and never silently displays invalid TP1 as 0.00');

  const exported = logger.export();
  ok(missingSetup.snapshotStatus === 'VALID_SNAPSHOT' && String(missingSetup.strategySetupSource ?? '').includes('entryConfigSnapshot'), '16 valid canonical snapshot without setupMetrics binds setup from entryConfigSnapshot');
  ok(!exported.includes('POSITION_STRATEGY_SETUP_MISSING_BUG: symbol=MISSUSDT'), '16a valid snapshot does not emit POSITION_STRATEGY_SETUP_MISSING_BUG');
  ok((legacy.strategySetupSummary ?? '').includes('N/A') && legacy.strategy.includes('LEGACY') && legacy.snapshotStatus === 'LEGACY_MISSING_SNAPSHOT', '17 legacy position shows missing strategy setup, not fake values');

  ok(panelSource.includes('setDiagRow(p)') && panelSource.includes('{diagRow && ('), '18 inspect drawer opens from open row');
  ok(panelSource.includes('Strategy: {diagRow.strategy}') || panelSource.includes('Selected:'), '19 inspect drawer shows selectedStrategy');
  ok(panelSource.includes('Setup result: {diagRow.strategySetupResult') || panelSource.includes('Final executable at entry'), '20 inspect drawer shows finalExecutableAtEntry/setup result');
  ok(panelSource.includes('Dip/Req: {diagRow.strategySetupDipReqLabel') && panelSource.includes('Rebound/Req: {diagRow.strategySetupReboundReqLabel'), '21-22 inspect drawer shows dip/rebound actual+required');
  ok(panelSource.includes('Setup metrics:') && panelSource.includes('strategySetupMetrics'), '23 inspect drawer shows metric role data from setup metrics');
  ok(panelSource.includes('Strategy setup snapshot:') && panelSource.includes('strategySetupSnapshot'), '24 inspect drawer shows sourceLayer data (raw snapshot)');
  ok(panelSource.includes('setupMissing') || panelSource.includes('setupPassed') || panelSource.includes('Setup result'), '25 inspect drawer shows setupPassed/setupMissing or resolved setup result');

  const setupMetricsPreview = JSON.stringify(cons.strategySetupMetrics);
  ok(!/undefined|null|NaN/i.test(setupMetricsPreview), '26 inspect drawer data model avoids raw undefined/null/NaN');

  ok(open.length > 0, '27 position manager has open positions after add');
  ok(model.openPositions.length === open.length, '28 panel source counts aligned');
  ok(cons.sourceUsed === 'PositionManager' && cons.snapshotPresent === true && cons.riskSnapshotPresent === true && cons.entrySnapshotPresent === true, '29 open row reports canonical PositionManager source and snapshots present');
  ok(cons.isLivePosition === true && cons.isLegacyPosition === false, '30 canonical open row is live, not legacy');
  ok(cons.tp1Pct === 1.7 && cons.tp1TargetPrice === 1.5255 && (cons.tp1Source ?? '').includes('AutoBots'), '31 canonical TP1 display comes from risk snapshot');
  ok(legacy.sourceUsed === 'PositionManager' && legacy.isLegacyPosition === true && legacy.riskSnapshotStatus === 'LEGACY_PRE_FIX', '32 legacy row is explicitly marked legacy pre-fix');
  ok(exported.includes('OPEN_POSITION_ROW_SOURCE_AUDIT') && exported.includes('sourceUsed=PositionManager') && exported.includes('riskSnapshotPresent=true'), '33 per-row source audit logs canonical source and risk snapshot presence');
  ok((cons.tp1Pct ?? 0) > 0, '36 new AutoBots open position displays TP1 > 0');
  ok((cons.tp1TargetPrice ?? 0) > cons.entryPrice, '37 TP1 target is greater than entry price');
  ok(Math.abs((cons.tp1TargetPrice ?? 0) - (cons.entryPrice * (1 + ((cons.tp1Pct ?? 0) / 100)))) < 1e-10, '38 TP1 target equals entryPrice*(1+tp1Pct/100)');
  ok((cons.tp1Source ?? '').toLowerCase().includes('autobots') && !(cons.tp1Source ?? '').toLowerCase().includes('legacy'), '39 TP1 source is AutoBots dynamic, not legacy');
  ok(cons.tp2Pct === 0, '40 AutoBots TP2 remains 0');
  ok(cons.slPct === 1.5, '41 SL is user-defined from snapshot');
  ok(String(cons.strategySetupSource ?? '').includes('entryConfigSnapshot') && cons.sourceUsed === 'PositionManager', '42 open row uses entry snapshot from PositionManager, not current candidate state');
  ok(!String(cons.strategySetupResult).toUpperCase().includes('WAITING'), '43 setup result is not WAITING after confirmed entry snapshot');
  ok(cons.dipPct === -2.1 && cons.reboundPct === 1.1 && cons.momentumConfirmed === true, '44 dip/rebound/momentum come from entry snapshot metrics');
  ok(exported.includes('OPEN_POSITION_CANONICAL_BINDING_AUDIT') && exported.includes('OPEN_POSITION_ENTRY_SNAPSHOT_AUDIT') && exported.includes('OPEN_POSITION_PRICE_TARGET_AUDIT'), '45 canonical entry/risk/price target audits are emitted');
  ok(exported.includes('targetMatchesSnapshot=true') && exported.includes('rowUsesCandidateState=false'), '46 target audit confirms formula match and no candidate-state binding');
  ok(bugRisk.snapshotStatus === 'BUG_MISSING_SNAPSHOT_NEW_POSITION' && bugRisk.riskSnapshotStatus === 'SNAPSHOT_MISSING', '47 new AutoBots missing risk snapshot is marked as a bug, not accepted as legacy');
  ok(bugRisk.tp1Pct === null && bugRisk.tp1TargetPrice === null && bugRisk.tp1Source === 'SNAPSHOT_MISSING', '48 new missing risk snapshot does not display TP1=0 or fake target');
  ok(exported.includes('POSITION_ENTRY_SNAPSHOT_MISSING_BUG') && exported.includes('BUGRISKUSDT'), '49 new missing snapshot emits explicit bug warning');
  ok(exported.includes('OPEN_POSITION_LEGACY_SNAPSHOT_WARNING') && exported.includes('BUGRISKUSDT') && exported.includes('SNAPSHOT_MISSING'), '50 missing risk snapshot emits safe UI warning/audit');
  ok(badTp1.riskSnapshotStatus === 'BUG_TP1_INVALID' && badTp1.tp1Pct === null && badTp1.tp1TargetPrice === null, '51 new AutoBots invalid TP1 snapshot is marked BUG_TP1_INVALID and does not display 0.00');
  ok(exported.includes('OPEN_POSITION_RENDER_ROW_AUDIT') && exported.includes('BADTP1USDT') && exported.includes('rawSnapshotTp1Pct=0') && exported.includes('displayedTp1Pct=BUG_TP1_INVALID_OR_MISSING'), '52 render row audit exposes raw TP1=0 vs safe displayed bug state');
  ok(exported.includes('UI_TP1_BINDING_BUG') && exported.includes('BADTP1USDT'), '53 invalid runtime TP1 emits UI_TP1_BINDING_BUG');

  const legacyClosed = mapTradeRecordToClosedPositionView(makeLegacyClosedTrade());
  mapTradeRecordToClosedPositionView(makeLegacyClosedTrade());
  const afterLegacyClosedExport = logger.export();
  ok(legacyClosed.snapshotStatus === 'LEGACY_MISSING_SNAPSHOT' && legacyClosed.riskSnapshotStatus === 'LEGACY_PRE_FIX', '54 legacy closed missing snapshot is classified as legacy pre-schema');
  ok(afterLegacyClosedExport.includes('legacySnapshotStatus=LEGACY_INCOMPLETE_PRE_SNAPSHOT_SCHEMA'), '55 legacy closed missing snapshot emits legacy classification instead of new-position bug');
  ok(!afterLegacyClosedExport.includes('tradeId=closed_LEGOLDUSDT note=SNAPSHOT_MISSING legacySnapshotStatus=BUG_MISSING_SNAPSHOT_NEW_POSITION'), '56 legacy closed trade does not pollute runtime health as new missing snapshot');

  const adapterSrc = readFileSync(path.resolve(process.cwd(), 'src/lib/air-scanner/tradeV4DataAdapter.ts'), 'utf8');
  const tradePageSrc = readFileSync(path.resolve(process.cwd(), 'src/ui/pages/TradePage.tsx'), 'utf8');
  ok(adapterSrc.includes('OPEN_POSITIONS_CANONICAL_SOURCE_AUDIT') && adapterSrc.includes('OPEN_POSITIONS_SOURCE_MISMATCH_WARNING'), '34 adapter audits canonical source mismatch');
  ok(tradePageSrc.includes('storeOpenPositionsCount: positionManagerOpenPositions.length') && !tradePageSrc.includes('legacyBrainPositions'), '35 TradePage binds store/header/open rows to PositionManager, not legacy brain cache');

  console.log(`open-positions-ui: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
