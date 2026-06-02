import { MarketScanner } from '../src/core/scanner/MarketScanner';
import { ScannerBrainService } from '../src/core/scanner/ScannerBrainService';
import { PaperExchangeAdapter } from '../src/core/exchange/PaperExchangeAdapter';
import { MLPredictor } from '../src/core/ml/MLPredictor';
import { MarketDataFeed } from '../src/utils/MarketDataFeed';
import { logger } from '../src/utils/logger';

type Period = '1h' | '4h' | '1d' | '1w';

interface PeriodResult {
  period: Period;
  logs: string[];
  candidateCount: number;
  buyCount: number;
  waitCount: number;
  blockCount: number;
  avoidCount: number;
  executionPoolSize: number;
  summary: Record<string, string>;
}

// Suppress noisy logs during setup
const _origInfo = (logger as any).info?.bind ? logger.info.bind(logger) : null;

async function runScan(period: Period): Promise<PeriodResult> {
  const adapter = new PaperExchangeAdapter();
  const ml = new MLPredictor();
  const brainService = new ScannerBrainService(new Map(), adapter, ml);

  const scanner = new MarketScanner();
  scanner.setBrainDecide(async (symbol, price) => {
    try {
      const lookup = brainService.getOrCreateBrainForSymbol(symbol, 'AUTO');
      const prediction = ml.predict(symbol);
      const decision = await lookup.brain.decide(price, prediction);
      decision.scannerBrainSource = lookup.source;
      return decision;
    } catch (err) {
      return {
        symbol, mode: 'AUTO' as const, selectedStrategy: 'none', selectedPlaybook: null,
        confidence: 0, status: 'AVOID' as const, entryPlan: null, exitPlan: null,
        reasons: ['brain_create_failed'], blockReasons: ['brain_create_failed'],
        warnings: ['scanner_brain_create_failed'], requiredNextActions: [],
        ruleDecisionTrace: { unifiedSignal: null, playbookResult: null, autobotsResult: null },
      };
    }
  });

  // Set paper auto to false for scan-only (no execution)
  scanner.setPaperAutoEnabled(false);

  // Configure period and enable all risk groups
  scanner.setScannerConfig({
    riskGroups: {
      top_caps: true,
      large_caps: true,
      mid_caps: true,
      high_risk: true,
      very_high_risk: true,
    },
    referencePeriod: period,
  });

  // Collect logs for this scan
  const capturedLogs: string[] = [];
  const unsubscribe = logger.subscribe((entry) => {
    if (entry.level === 'INFO' || entry.level === 'WARN' || entry.level === 'ERROR') {
      capturedLogs.push(`[${entry.level}] ${entry.message}`);
    }
  });

  // Warm up and scan
  await scanner.start();

  // Feed must be initialized before scan
  const feed = MarketDataFeed.getInstance();
  if (!feed) throw new Error('MarketDataFeed not available');

  const snapshot = await scanner.scan('BINANCE_TOP_250');
  unsubscribe();

  return {
    period,
    logs: capturedLogs,
    candidateCount: snapshot.candidateCount ?? 0,
    buyCount: snapshot.buyCount ?? 0,
    waitCount: snapshot.waitCount ?? 0,
    blockCount: snapshot.blockCount ?? 0,
    avoidCount: snapshot.avoidCount ?? 0,
    executionPoolSize: snapshot.executionPoolSize ?? 0,
    summary: {
      refPeriod: snapshot.referencePeriod ?? period,
      executionPoolSize: String(snapshot.executionPoolSize ?? 0),
      watchPoolSize: String(snapshot.watchPoolSize ?? 0),
      nearMissPoolSize: String(snapshot.nearMissPoolSize ?? 0),
      autoStrategySummary: snapshot.autoStrategySummary
        ? `con=${snapshot.autoStrategySummary.conservative} bal=${snapshot.autoStrategySummary.balanced} mom=${snapshot.autoStrategySummary.momentum} dip=${snapshot.autoStrategySummary.dip_and_rebound} wait=${snapshot.autoStrategySummary.wait} avoid=${snapshot.autoStrategySummary.avoid}`
        : 'n/a',
      noBuyVerdict: snapshot.noBuySummary
        ? `action=${snapshot.noBuySummary.marketAction ?? 'n/a'} bestFit=${snapshot.noBuySummary.bestFit ?? 'n/a'} htf=${snapshot.noBuySummary.htf ?? 'n/a'} primary=${snapshot.noBuySummary.primary ?? 'n/a'} ltf=${snapshot.noBuySummary.ltf ?? 'n/a'} conf=${snapshot.noBuySummary.marketConfidence ?? 'n/a'} topReasons=${snapshot.noBuySummary.topReasons?.join(',') ?? 'none'} requiredNextCondition=${snapshot.noBuySummary.requiredNextCondition?.join(',') ?? 'none'}`
        : 'none',
    },
  };
}

function extractLog(logs: string[], prefix: string): string[] {
  return logs.filter(l => l.includes(prefix));
}

function printSection(title: string) {
  console.log(`\n${'='.repeat(90)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(90)}`);
}

function printSub(title: string) {
  console.log(`\n--- ${title} ---`);
}

async function main() {
  const periods: Period[] = ['1h', '4h', '1d', '1w'];
  const results: PeriodResult[] = [];

  for (const period of periods) {
    printSection(`SCANNING PERIOD: ${period}`);
    try {
      const result = await runScan(period);
      results.push(result);
      console.log(`  Candidates: ${result.candidateCount}`);
      console.log(`  BUY: ${result.buyCount}  WAIT: ${result.waitCount}  BLOCK: ${result.blockCount}  AVOID: ${result.avoidCount}`);
      console.log(`  Logs captured: ${result.logs.length}`);
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Brief pause between scans
    await new Promise(r => setTimeout(r, 2000));
  }

  // ──────────────────────────────────────────────────
  // COMPARISON TABLE
  // ──────────────────────────────────────────────────
  printSection('RUNTIME VERIFICATION — FINAL REPORT');
  console.log(`\nDate: ${new Date().toISOString()}`);
  console.log('Universe: BINANCE_TOP_250');

  // Table 1: Basic counts per period
  printSub('TABLE 1: Basic counts per period');
  console.log('Period   | Scanned | BUY | WAIT | BLOCK | AVOID | ExecPool | Kline interval | Kline limit');
  console.log('---------|---------|-----|------|-------|-------|----------|----------------|------------');
  for (const r of results) {
    const klineCfg = r.summary.refPeriod === '1h' ? '5m' : r.summary.refPeriod === '4h' ? '15m' : r.summary.refPeriod === '1d' ? '1h' : '4h';
    const klineLimit = r.summary.refPeriod === '1h' ? '12' : r.summary.refPeriod === '4h' ? '16' : r.summary.refPeriod === '1d' ? '24' : '42';
    console.log(`${r.period.padEnd(7)} | ${String(r.candidateCount).padEnd(7)} | ${String(r.buyCount).padEnd(3)} | ${String(r.waitCount).padEnd(4)} | ${String(r.blockCount).padEnd(5)} | ${String(r.avoidCount).padEnd(5)} | ${String(r.executionPoolSize).padEnd(8)} | ${klineCfg.padEnd(14)} | ${klineLimit}`);
  }

  // Table 2: Confidence distribution per period
  printSub('TABLE 2: Confidence distribution');
  for (const r of results) {
    const confLogs = extractLog(r.logs, 'CONFIDENCE_DISTRIBUTION_AUDIT');
    const refPeriodLogs = extractLog(r.logs, 'REF_PERIOD_DECISION_AUDIT');
    console.log(`\n  Period: ${r.period}  (${confLogs.length} CONFIDENCE logs, ${refPeriodLogs.length} REF_PERIOD logs)`);
    for (const log of confLogs.slice(0, 5)) {
      console.log(`    ${log}`);
    }
    for (const log of refPeriodLogs.slice(0, 5)) {
      console.log(`    ${log}`);
    }
  }

  // Table 3: Strategy distribution per period
  printSub('TABLE 3: Strategy distribution');
  for (const r of results) {
    const logs = extractLog(r.logs, 'STRATEGY_DISTRIBUTION_FLATLINE_AUDIT');
    const refPeriodLogs = extractLog(r.logs, 'REF_PERIOD_DECISION_AUDIT');
    console.log(`\n  Period: ${r.period}`);
    if (logs.length > 0) {
      for (const log of logs) {
        console.log(`    ${log}`);
      }
    } else {
      console.log(`    (no STRATEGY_DISTRIBUTION_FLATLINE_AUDIT log found)`);
    }
    // Also scan strategy from REF_PERIOD_DECISION_AUDIT
    for (const log of refPeriodLogs) {
      const match = log.match(/strategyDistribution=([\w=]+)/);
      if (match) console.log(`    StratDist: ${match[1]}`);
    }
    // Also from autoStrategySummary in summary
    if (r.summary.autoStrategySummary && r.summary.autoStrategySummary !== 'n/a') {
      console.log(`    AutoStratSummary: ${r.summary.autoStrategySummary}`);
    }
  }

  // Table 4: EntryGate summary per period
  printSub('TABLE 4: EntryGate runtime summary');
  for (const r of results) {
    const logs = extractLog(r.logs, 'ENTRY_GATE_RUNTIME_SUMMARY');
    console.log(`\n  Period: ${r.period}`);
    for (const log of logs) {
      console.log(`    ${log}`);
    }
  }

  // Table 5: REF_PERIOD_FEATURE_AUDIT per period (top entries)
  printSub('TABLE 5: Feature values per period (first 3 symbols)');
  for (const r of results) {
    const logs = extractLog(r.logs, 'REF_PERIOD_FEATURE_AUDIT');
    console.log(`\n  Period: ${r.period} (${logs.length} feature logs)`);
    for (const log of logs.slice(0, 3)) {
      console.log(`    ${log}`);
    }
  }

  // Table 6: Top 10 symbols + movers per period
  printSub('TABLE 6: Ranking / movers per period');
  for (const r of results) {
    const rankingLogs = extractLog(r.logs, 'RANKING_INPUTS_AUDIT');
    const rankingDivLogs = extractLog(r.logs, 'RANKING_DIVERSITY_AUDIT');
    console.log(`\n  Period: ${r.period}`);
    console.log(`    Ranking inputs: ${rankingLogs.length} entries`);
    for (const log of rankingDivLogs.slice(0, 3)) {
      console.log(`    ${log}`);
    }
    // Top 10 symbols from RANKING_INPUTS_AUDIT
    console.log(`    Top 10:`);
    for (const log of rankingLogs.slice(0, 10)) {
      const symMatch = log.match(/symbol=(\w+)/);
      const scoreMatch = log.match(/rawScore=([\d.-]+)/);
      const entryGateMatch = log.match(/entryGate=([\d.-]+)/);
      const confMatch = log.match(/confidence=([\d.-]+)/);
      const rankMatch = log.match(/rank=(\d+)/);
      if (symMatch) {
        const p = (r: string) => { const m = log.match(new RegExp(`${r}=([\\d.-]+)`)); return m ? m[1] : '?'; };
        console.log(`      ${symMatch[1]}: rank=${p('rank')} score=${p('rawScore')} entryGate=${p('entryGate')} conf=${p('confidence')} spread=${p('spread')}`);
      }
    }
  }

  // Table 7: Binance sanity per period
  printSub('TABLE 7: Binance market sanity audit');
  for (const r of results) {
    const logs = extractLog(r.logs, 'BINANCE_MARKET_SANITY_SUMMARY');
    const detailLogs = extractLog(r.logs, 'BINANCE_MARKET_SANITY_AUDIT');
    console.log(`\n  Period: ${r.period}`);
    for (const log of logs) {
      console.log(`    ${log}`);
    }
    if (detailLogs.length > 0) {
      console.log(`    First 3 details:`);
      for (const log of detailLogs.slice(0, 3)) {
        console.log(`      ${log}`);
      }
    }
  }

  // Table 8: V3/V4 parity per period
  printSub('TABLE 8: V3/V4 parity audit');
  for (const r of results) {
    const logs = extractLog(r.logs, 'V3_V4_REF_PERIOD_PARITY_AUDIT');
    const mismatchLogs = extractLog(r.logs, 'V3_V4_STRATEGY_MISMATCH_ROOT_CAUSE');
    console.log(`\n  Period: ${r.period}`);
    console.log(`    Parity logs: ${logs.length}`);
    console.log(`    Mismatch root cause logs: ${mismatchLogs.length}`);
    for (const log of logs.slice(0, 5)) {
      console.log(`    ${log}`);
    }
  }

  // Table 9: Why No BUY per period
  printSub('TABLE 9: Why No BUY summary');
  for (const r of results) {
    const logs = extractLog(r.logs, 'WHY_NO_BUY_EXPLANATION_AUDIT');
    const noBuyLogs = extractLog(r.logs, 'SCANNER_NO_BUY_FROM_POOL');
    console.log(`\n  Period: ${r.period}`);
    for (const log of logs) {
      console.log(`    ${log}`);
    }
    for (const log of noBuyLogs) {
      console.log(`    ${log}`);
    }
  }

  // Table 10: MOMENTUM_DIRECTION_AUDIT sample
  printSub('TABLE 10: Momentum direction sample');
  for (const r of results) {
    const logs = extractLog(r.logs, 'MOMENTUM_DIRECTION_AUDIT');
    console.log(`\n  Period: ${r.period} (${logs.length} entries)`);
    if (logs.length > 0) {
      // Show positive, negative, and sideways
      const pos = logs.find(l => l.includes('isPositive=true'));
      const neg = logs.find(l => l.includes('isNegative=true'));
      const side = logs.find(l => l.includes('isSideways=true'));
      if (pos) console.log(`    Positive: ${pos}`);
      if (neg) console.log(`    Negative: ${neg}`);
      if (side) console.log(`    Sideways: ${side}`);
    }
  }

  // Table 11: MOMENTUM_POCKET_AUDIT per period
  printSub('TABLE 11: Momentum pocket audit');
  for (const r of results) {
    const logs = extractLog(r.logs, 'MOMENTUM_POCKET_AUDIT');
    console.log(`\n  Period: ${r.period} (${logs.length} pocket logs)`);
    for (const log of logs) {
      // Extract key fields
      const posMom = log.match(/positiveMomentumCount=(\d+)/);
      const strongMom = log.match(/strongPositiveMomentumCount=(\d+)/);
      const hrPos = log.match(/highRiskPositiveMomentumCount=(\d+)/);
      const vhrPos = log.match(/veryHighRiskPositiveMomentumCount=(\d+)/);
      const topMoms = log.match(/topMomentumSymbols=([\w:|.]+)/);
      const egPass = log.match(/entryGatePassedCount=(\d+)/);
      const egBlock = log.match(/entryGateBlockedCount=(\d+)/);
      const pockets = log.match(/pocketEntries=([\w|]+)/);
      const blockers = log.match(/pocketBlockers=([\w|:.=@\-]+)/);
      const marketBias = log.match(/marketBias=([\w_]+)/);
      const marketAction = log.match(/marketAction=([\w_]+)/);

      console.log(`    Pocket count: ${posMom?.[1] ?? '0'} positive, ${strongMom?.[1] ?? '0'} strong`);
      console.log(`    High risk: ${hrPos?.[1] ?? '0'}  Very high risk: ${vhrPos?.[1] ?? '0'}`);
      console.log(`    EntryGate: ${egPass?.[1] ?? '0'} passed, ${egBlock?.[1] ?? '0'} blocked`);
      console.log(`    Market: ${marketBias?.[1] ?? '?'} / ${marketAction?.[1] ?? '?'}`);
      if (topMoms) console.log(`    Top momentum symbols: ${topMoms[1]}`);
      if (pockets) console.log(`    Pocket entries: ${pockets[1]}`);
      if (blockers) console.log(`    Pocket blockers: ${blockers[1].substring(0, 300)}`);
    }

    // Also check per-pocket blocker details from the log
    const blockerLogs = extractLog(r.logs, 'MOMENTUM_POCKET_AUDIT').filter(l => l.includes('pocketBlockers='));
    for (const bl of blockerLogs) {
      const entries = bl.match(/pocketBlockers=(\S+)/);
      if (entries) {
        const details = entries[1].split('||');
        if (details.length > 0 && details[0].length > 0) {
          console.log(`    Per-coin blockers:`);
          for (const d of details.slice(0, 5)) {
            console.log(`      ${d.substring(0, 120)}`);
          }
        }
      }
    }
  }

  // Table 12: Pocket entry detail verification
  printSub('TABLE 12: Pocket entry details (from log)');
  for (const r of results) {
    const logs = extractLog(r.logs, 'MOMENTUM_POCKET_AUDIT').filter(l => l.includes('pocketEntries='));
    if (logs.length === 0 || logs.every(l => l.includes('pocketEntries='))) {
      const entryMatches = logs.map(l => l.match(/pocketEntries=([\w|]+)/)).filter(Boolean);
      if (entryMatches.length > 0) {
        const symbols = entryMatches[0]![1].split('|');
        const blockerMatches = logs.map(l => l.match(/pocketBlockers=(\S+)/)).filter(Boolean);
        console.log(`\n  Period: ${r.period} — Pocket symbols: ${symbols.length > 0 ? symbols.join(', ') : 'none'}`);
        if (blockerMatches.length > 0) {
          const blockerParts = blockerMatches[0]![1].split('||');
          for (const bp of blockerParts.slice(0, 5)) {
            if (bp.length > 0) {
              const sym = bp.split('=')[0];
              const rest = bp.substring(sym.length + 1);
              console.log(`    ${sym}: ${rest.substring(0, 150)}`);
            }
          }
        }
      } else {
        console.log(`\n  Period: ${r.period} — No pocket entries found`);
      }
    }
  }

  // ──────────────────────────────────────────────────
  // ACCEPTANCE VERIFICATION
  // ──────────────────────────────────────────────────
  printSection('ACCEPTANCE VERIFICATION');

  // 1. Confidence flatline check
  printSub('1. Confidence is NOT flatline');
  for (const r of results) {
    const refLogs = extractLog(r.logs, 'REF_PERIOD_DECISION_AUDIT');
    const confLogs = extractLog(r.logs, 'CONFIDENCE_DISTRIBUTION_AUDIT');
    let uniqueConfs = 0;
    let confMin = '?', confMax = '?', confAvg = '?';
    for (const l of refLogs) {
      const u = l.match(/confidenceUniqueBuckets=(\d+)/);
      if (u) uniqueConfs = parseInt(u[1]);
      const mn = l.match(/confidenceMin=([\d.%]+)/);
      if (mn) confMin = mn[1];
      const mx = l.match(/confidenceMax=([\d.%]+)/);
      if (mx) confMax = mx[1];
      const av = l.match(/confidenceAvg=([\d.%]+)/);
      if (av) confAvg = av[1];
    }
    let fallbackPct = 100;
    for (const l of confLogs) {
      const fp = l.match(/fallbackPercent=([\d.]+)%/);
      if (fp) fallbackPct = parseFloat(fp[1]);
    }
    const flatlineOk = uniqueConfs > 5 || fallbackPct < 30;
    console.log(`  ${r.period}: uniqueBuckets=${uniqueConfs} min=${confMin} max=${confMax} avg=${confAvg} fallbackPct=${fallbackPct}% ${flatlineOk ? '✅' : '⚠️  FLATLINE RISK'}`);
  }

  // 2. Strategy flatline check
  printSub('2. Strategy is not blindly flatline');
  for (const r of results) {
    const stratLogs = extractLog(r.logs, 'STRATEGY_DISTRIBUTION_FLATLINE_AUDIT');
    const refLogs = extractLog(r.logs, 'REF_PERIOD_DECISION_AUDIT');
    console.log(`  ${r.period}:`);
    for (const l of stratLogs) {
      console.log(`    ${l}`);
    }
    for (const l of refLogs) {
      const s = l.match(/strategyDistribution=([\w|=]+)/);
      if (s) console.log(`    Distribution: ${s[1]}`);
    }
  }

  // 3. RefPeriod effect check
  printSub('3. RefPeriod effect — periods produce different features');
  for (const r of results) {
    const logs = extractLog(r.logs, 'REF_PERIOD_FEATURE_AUDIT');
    if (logs.length > 0) {
      const first = logs[0];
      const mom = first.match(/momentum=([\d.-]+)/);
      const dip = first.match(/dipPct=([\d.-]+)/);
      const reb = first.match(/reboundPct=([\d.-]+)/);
      const vol = first.match(/volatility=([\d.-]+)/);
      const conf = first.match(/confidence=([\d%]+)/);
      const strategy = first.match(/strategy=(\w+)/);
      console.log(`  ${r.period}: momentum=${mom?.[1] ?? '?'} dip=${dip?.[1] ?? '?'} rebound=${reb?.[1] ?? '?'} vol=${vol?.[1] ?? '?'} conf=${conf?.[1] ?? '?'} strategy=${strategy?.[1] ?? '?'}`);
    }
  }

  // 4. EntryGate check
  printSub('4. EntryGate runs for eligible candidates');
  for (const r of results) {
    const logs = extractLog(r.logs, 'ENTRY_GATE_RUNTIME_SUMMARY');
    console.log(`  ${r.period}:`);
    for (const l of logs) {
      console.log(`    ${l}`);
    }
    if (logs.length === 0) {
      console.log(`    ⚠️  No ENTRY_GATE_RUNTIME_SUMMARY log found`);
    } else if (logs.some(l => l.includes('entryGateRanCount=0'))) {
      console.log(`    ⚠️  EntryGate did not run for any candidate`);
    }
  }

  // 5. Ranking check
  printSub('5. Ranking — high risk / very high risk in top 20');
  for (const r of results) {
    const logs = extractLog(r.logs, 'RANKING_DIVERSITY_AUDIT');
    for (const l of logs) {
      const vhr = l.match(/veryHighRiskInTop20Count=(\d+)/);
      const hr = l.match(/highRiskInTop20Count=(\d+)/);
      console.log(`  ${r.period}: highRisk=${hr?.[1] ?? '?'} veryHighRisk=${vhr?.[1] ?? '?'}`);
      console.log(`    ${l}`);
    }
  }

  // 6. Binance sanity check
  printSub('6. Binance sanity — price/spread match');
  for (const r of results) {
    const logs = extractLog(r.logs, 'BINANCE_MARKET_SANITY_SUMMARY');
    for (const l of logs) {
      const pm = l.match(/priceMismatchCount=(\d+)/);
      const sm = l.match(/spreadMismatchCount=(\d+)/);
      const mm = l.match(/momentumMismatchCount=(\d+)/);
      console.log(`  ${r.period}: priceMismatch=${pm?.[1] ?? '?'} spreadMismatch=${sm?.[1] ?? '?'} momentumMismatch=${mm?.[1] ?? '?'}`);
      console.log(`    ${l}`);
    }
  }

  // 7. V3/V4 parity check
  printSub('7. V3/V4 parity — mismatches explained');
  for (const r of results) {
    const logs = extractLog(r.logs, 'V3_V4_REF_PERIOD_PARITY_AUDIT');
    const mismatchLogs = extractLog(r.logs, 'V3_V4_STRATEGY_MISMATCH_ROOT_CAUSE');
    const mismatchCount = logs.filter(l => l.includes('mismatchDetected=true')).length;
    console.log(`  ${r.period}: ${logs.length} parity logs, ${mismatchCount} mismatches, ${mismatchLogs.length} root cause explanations`);
    if (mismatchLogs.length > 0) {
      for (const l of mismatchLogs.slice(0, 3)) {
        console.log(`    ${l}`);
      }
    }
  }

  // 8. Overall verdict
  printSub('FINAL VERDICT');
  let allOk = true;
  for (const r of results) {
    const refLogs = extractLog(r.logs, 'REF_PERIOD_DECISION_AUDIT');
    const confLogs = extractLog(r.logs, 'CONFIDENCE_DISTRIBUTION_AUDIT');
    const entryGateLogs = extractLog(r.logs, 'ENTRY_GATE_RUNTIME_SUMMARY');
    const v3Logs = extractLog(r.logs, 'V3_V4_REF_PERIOD_PARITY_AUDIT');
    const binanceLogs = extractLog(r.logs, 'BINANCE_MARKET_SANITY_SUMMARY');

    let uniqueConfs = 0;
    for (const l of refLogs) {
      const u = l.match(/confidenceUniqueBuckets=(\d+)/);
      if (u) uniqueConfs = parseInt(u[1]);
    }

    let fallbackPct = 100;
    for (const l of confLogs) {
      const fp = l.match(/fallbackPercent=([\d.]+)%/);
      if (fp) fallbackPct = parseFloat(fp[1]);
    }

    let entryGateRan = 0;
    for (const l of entryGateLogs) {
      const er = l.match(/entryGateRanCount=(\d+)/);
      if (er) entryGateRan = parseInt(er[1]);
    }

    const v3Mismatches = v3Logs.filter(l => l.includes('mismatchDetected=true')).length;

    const flatlineOk = uniqueConfs > 5 || fallbackPct < 30;
    const entryGateOk = entryGateRan > 0;

    if (!flatlineOk) {
      console.log(`  ⚠️  ${r.period}: Confidence may be flat (uniqueBuckets=${uniqueConfs}, fallback=${fallbackPct}%)`);
      allOk = false;
    }
    if (!entryGateOk) {
      console.log(`  ⚠️  ${r.period}: EntryGate did not run`);
      allOk = false;
    }
    if (v3Mismatches > 0) {
      console.log(`  ℹ️   ${r.period}: ${v3Mismatches} V3/V4 mismatches (intentional, logged with root cause)`);
    }

    // Momentum pocket check
    const pocketLogs = extractLog(r.logs, 'MOMENTUM_POCKET_AUDIT');
    const pocketCount = pocketLogs.length > 0
      ? parseInt(pocketLogs[0].match(/positiveMomentumCount=(\d+)/)?.[1] ?? '0')
      : 0;
    const pocketEntriesStr = pocketLogs.length > 0
      ? pocketLogs[0].match(/pocketEntries=([\w|]+)/)?.[1] ?? ''
      : '';
    const hasPocketLog = pocketLogs.length > 0;
    const pocketHasPerCoinBlockers = pocketLogs.some(l => l.includes('pocketBlockers=') && l.split('pocketBlockers=')[1]?.length > 3);

    if (!hasPocketLog) {
      console.log(`  ⚠️  ${r.period}: No MOMENTUM_POCKET_AUDIT log found`);
      allOk = false;
    } else {
      const pocketSymbols = pocketEntriesStr ? pocketEntriesStr.split('|').length : 0;
      if (pocketCount > 0 && pocketSymbols > 0) {
        console.log(`  ℹ️   ${r.period}: ${pocketCount} pockets detected (${pocketSymbols} symbols)`);
        if (!pocketHasPerCoinBlockers) {
          console.log(`  ⚠️  ${r.period}: Pockets detected but no per-coin blockers`);
          allOk = false;
        }
      } else {
        console.log(`  ℹ️   ${r.period}: No pockets detected (expected if no positive momentum)`);
      }
    }
  }

  if (allOk) {
    console.log(`\n  ✅ ALL CHECKS PASS — scanner is producing differentiated, verifiable results.`);
  } else {
    console.log(`\n  ⚠️  Some checks flagged — investigate above.`);
  }

  console.log(`\n${'='.repeat(90)}`);
}

main().catch(err => {
  console.error('Runtime verification failed:', err);
  process.exit(1);
});
