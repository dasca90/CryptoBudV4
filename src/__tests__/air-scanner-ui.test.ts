import { readFileSync } from 'node:fs';
import { mapCandidatesToAirCoins } from '../lib/air-scanner/airCoinVisualMapper';
import { mapScannerCandidateToTradeV4View } from '../lib/air-scanner/tradeV4DataAdapter';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const tradePageSrc = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
const tradeV4Src = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const airScannerPageSrc = readFileSync('src/ui/pages/AirScannerPage.tsx', 'utf8');
const openSrc = readFileSync('src/components/trade-v4/OpenPositionsPanel.tsx', 'utf8');
const closedSrc = readFileSync('src/components/trade-v4/ClosedPositionsPanel.tsx', 'utf8');
const topSrc = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const paramsSrc = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
const scannerSrc = readFileSync('src/components/trade-v4/AirScanner3D.tsx', 'utf8');
const mapperSrc = readFileSync('src/lib/ui/uiSymbolMapper.ts', 'utf8');
const candidateSrc = readFileSync('src/components/trade-v4/CandidateTable.tsx', 'utf8');
const candidatePoolSrc = readFileSync('src/components/trade-v4/CandidatePoolSummaryPanel.tsx', 'utf8');
const cssSrc = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');
const airScannerCssSrc = readFileSync('src/components/trade-v4/air-scanner.css', 'utf8');
const selectedSrc = readFileSync('src/components/trade-v4/SelectedCoinInspector.tsx', 'utf8');
const airCoinSrc = readFileSync('src/components/trade-v4/AirCoin.tsx', 'utf8');
const adapterSrc = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');
const coinLogoSrc = readFileSync('src/components/trade-v4/CoinLogo.tsx', 'utf8');
const labCoinOrbSrc = readFileSync('src/features/air-scanner-lab/components/CoinOrb.tsx', 'utf8');

ok((tradeV4Src.includes('trade-v4-right') || tradeV4Src.includes('right-column')) && tradeV4Src.includes('<SelectedCoinInspector'), 'A Selected Coin remains in right column');
ok(tradeV4Src.includes('<TopCandidatesPanel') && tradeV4Src.indexOf('<TopCandidatesPanel') > tradeV4Src.indexOf('data-testid="trade-scanner-status-panel"') && tradeV4Src.indexOf('<TopCandidatesPanel') < tradeV4Src.indexOf('<CandidatePoolSummaryPanel'), 'B Top Candidates renders wide under Scanner Status in center column');
ok(tradeV4Src.includes('<CandidatePoolSummaryPanel'), 'B2 CandidatePoolSummaryPanel renders in center');
ok(!tradeV4Src.includes('<AirScanner3D') && !tradeV4Src.includes('<AirScannerProductionPreview'), 'B3 Trade tab does not mount 3D scanner components');
ok(airScannerPageSrc.includes('lazy(() => import') && airScannerPageSrc.includes('<AirScanner3DView') && airScannerPageSrc.includes('<AirScannerProductionPreview'), 'B3b isolated 3D Scanner tab lazy-loads visual scanner components');
ok(tradeV4Src.includes('scannerTelemetry={{') && candidatePoolSrc.includes('candidate-pool-scanner-telemetry'), 'B4 scanner telemetry card remains lightweight in Candidate Pool');
ok(openSrc.includes('PAGE_SIZE = 10') && openSrc.includes('Page {safePage} / {totalPages}'), 'C Open Positions paginates at 10 rows');
ok(closedSrc.includes('PAGE_SIZE = 10') && closedSrc.includes('Page {safePage} / {totalPages}'), 'D Closed Positions paginates at 10 rows');
ok(openSrc.includes('Prev') && openSrc.includes('Next') && closedSrc.includes('Prev') && closedSrc.includes('Next'), 'E pagination prev/next works');
ok(paramsSrc.includes('Strategy') && paramsSrc.includes('Stop Loss (SL)') && paramsSrc.includes('TP1') && paramsSrc.includes('TP2') && paramsSrc.includes('Ref Window') && paramsSrc.includes('Ref Mode'), 'F Trading Parameters card renders required fields');
ok(paramsSrc.includes('REF_MODE_HELPERS') && paramsSrc.includes('data-testid="ref-mode-helper-dropdown"'), 'F1 Ref Mode uses custom helper dropdown');
ok(['AUTO', 'SMA', 'EMA', 'VWAP', 'BOLLINGER'].every(mode => paramsSrc.includes(`data-testid={\`ref-mode-option-${mode}\`}`) || paramsSrc.includes(`${mode}: {`)), 'F1b Ref Mode helper covers every mode type');
ok(!paramsSrc.includes('<select value={v.refMode}'), 'F1c Ref Mode is not a native select because option hover helpers do not work reliably');
ok(paramsSrc.includes('AutoBots dynamic per coin'), 'F2 AutoBots mode displays TP1 as dynamic ownership');
ok(paramsSrc.includes('0 / disabled in AutoBots'), 'F3 AutoBots mode displays TP2 disabled');
ok(paramsSrc.includes('Starts at TP1'), 'F4 AutoBots mode displays trailing start ownership');
ok(tradePageSrc.includes('airParams') && tradePageSrc.includes('onChangeParameters={(next) =>'), 'G parameter controls bind to existing UI/store state only');
ok(topSrc.includes('onSelectSymbol') && !topSrc.includes('onManualBuy') && !topSrc.includes('execute'), 'H candidate click selects symbol only');
ok(!paramsSrc.includes('onManualBuy') && !paramsSrc.includes('execute') && !paramsSrc.includes('submitOrder'), 'I no direct trade execution from parameter card');
ok(!mapperSrc.includes('"?"'), 'M no random question-mark icon fallbacks in symbol mapper');
ok(mapperSrc.includes('getCoinLogoMeta') && mapperSrc.includes('COIN_LOGOS'), 'M2 coin logo metadata resolver exists');
ok(coinLogoSrc.includes('CoinLogo') && coinLogoSrc.includes('CoinSymbolCell') && coinLogoSrc.includes('getCoinLogoMeta'), 'M3 reusable CoinLogo and CoinSymbolCell components exist');
ok(openSrc.includes('CoinSymbolCell') && closedSrc.includes('CoinSymbolCell'), 'M4 Open and Closed Positions render coin logos in Symbol cells');
ok(labCoinOrbSrc.includes('getCoinLogoMeta') && labCoinOrbSrc.includes('coinLogo.mark'), 'M5 3D scanner orb label uses same coin logo metadata');
ok(selectedSrc.includes('No coin selected'), 'N Selected Coin shows "No coin selected" fallback');
ok(candidateSrc.includes('toFixed(2)') && candidateSrc.includes('toFixed(1)') && candidateSrc.includes('n/a'), 'O candidate numeric formatting and n/a fallback present');
ok(cssSrc.includes('table-scroll-x') && cssSrc.includes('reason-cell') && cssSrc.includes('text-overflow: ellipsis'), 'P table has overflow-x and reason truncation styles');
ok(cssSrc.includes('right-column') && cssSrc.includes('flex-direction: column'), 'Q right stack uses non-overlapping vertical layout');
ok(tradeV4Src.includes('data-testid="trade-scanner-status-panel"') && tradeV4Src.includes('data-air-scanner-renderer="not-mounted-trade-tab"'), 'Q2 Trade tab renders lightweight scanner status instead of 3D');
ok(!tradeV4Src.includes("setScannerMode('hidden')") && !tradeV4Src.includes("trade-v4-scanner-mode"), 'Q3 Trade tab removed CSS-only hidden scanner mode');
ok(tradeV4Src.includes('data-testid="scanner-summary-bar"'), 'Q4 scanner summary bar renders without 3D');
ok(cssSrc.includes('.scanner-v3.scanner-mode-status') && cssSrc.includes('min-height: 112px'), 'Q5 scanner status container has compact vertical guard');
ok(cssSrc.includes('.center-top-v4') && cssSrc.includes('.center-bottom-v4'), 'Q6 center workspace splits into top and bottom priority zones');
ok(cssSrc.includes('.open-v4 .data-table thead th') && cssSrc.includes('.closed-v4 .data-table thead th'), 'Q7 positions tables use sticky headers');
ok((openSrc.includes('overflow: "hidden auto", flex: 1') || openSrc.includes('panel-scroll-v4')) && (closedSrc.includes('overflow: "hidden auto", flex: 1') || closedSrc.includes('panel-scroll-v4')), 'Q8 position tables scroll internally');
ok(tradeV4Src.includes('data-testid="open-positions-workspace"') && tradeV4Src.includes('data-testid="closed-positions-workspace"'), 'Q9 open/closed workspaces are explicitly mounted in center layout');
ok(tradeV4Src.includes('data-testid="market-groups-workspace"') && tradeV4Src.indexOf('data-testid="market-groups-workspace"') > tradeV4Src.indexOf('<SelectedCoinInspector'), 'Q10 Market Groups renders below Selected Coin in right rail');
ok(cssSrc.includes('.center-bottom-v4') && cssSrc.includes('grid-template-columns: minmax(320px, 38%) minmax(520px, 62%)'), 'Q11 center bottom is strict 2-column grid (pool | closed)');
ok(cssSrc.includes('.trade-v4-right') && cssSrc.includes('grid-template-rows: minmax(260px, 44%) minmax(240px, 56%)'), 'Q12 right rail uses explicit two-panel vertical stack grid');
ok(!scannerSrc.includes('DEPTH 1000m'), 'Q13 scanner depth text removed');
ok(scannerSrc.includes('position_opened_hold') && scannerSrc.includes('legend-item'), 'Q14 scanner legend uses canonical position-open state and explicit labels');
ok(scannerSrc.includes('scanner-has-coins') && scannerSrc.includes('scanner-empty'), 'Q14b scanner core pulse state follows rendered coin count');
ok(airScannerCssSrc.includes('core-scan-ping 10s') && airScannerCssSrc.includes('beam-scan-ping 10s'), 'Q14c scanner idle pulse runs once every 10 seconds');
ok(airScannerCssSrc.includes('.scanner-has-coins .capture-beam') && airScannerCssSrc.includes('opacity: 0.08'), 'Q14d scanner pulse quiets after coins appear');
ok(!airScannerCssSrc.includes('core-breathe 6s ease-in-out infinite'), 'Q14e scanner core no longer breathes continuously');
ok(openSrc.includes('v3-pill') && openSrc.includes('trendTone') && openSrc.includes('strategyTone'), 'Q15 open positions use V3-style colored badges');
ok(openSrc.includes('Strategy') && openSrc.includes('Trend') && openSrc.includes('V3_OPEN_POSITION_COLUMNS'), 'Q16 open positions render V3 strategy + trend columns');
ok(closedSrc.includes('closeReasonTone') && closedSrc.includes('v3-pill'), 'Q17 closed positions use V3-style close reason badges');
ok(cssSrc.includes('.pill-green') && cssSrc.includes('.pill-red') && cssSrc.includes('.pill-yellow') && cssSrc.includes('.pill-purple'), 'Q18 V3 badge color palette classes exist');
ok(openSrc.includes('panel-shell-open') && cssSrc.includes('.panel-shell-open'), 'Q19 open panel renders dedicated visible border shell token');
ok(closedSrc.includes('panel-shell-closed') && cssSrc.includes('.panel-shell-closed'), 'Q20 closed panel renders dedicated visible border shell token');
ok(openSrc.includes('OPEN POSITIONS (') && closedSrc.includes('CLOSED POSITIONS ('), 'Q21 open/closed headers show explicit panel titles with counts');
ok(openSrc.includes('panel-filter-btn') && closedSrc.includes('panel-filter-btn'), 'Q22 filter button remains inside open/closed panel headers');
ok(openSrc.includes('panel-scroll-v4') && closedSrc.includes('panel-scroll-v4') && cssSrc.includes('.panel-scroll-v4'), 'Q23 table scrollbar remains inside panel body');
ok(openSrc.includes('No open positions.') && closedSrc.includes('No closed trades yet.'), 'Q24 empty open/closed states still render bordered shells with message');
ok(tradeV4Src.includes('panel-shell-scanner') && tradeV4Src.includes('panel-shell-candidate'), 'Q25 scanner and candidate pool use visible shell contours');
ok(tradeV4Src.includes('panel-shell-selected') && tradeV4Src.includes('panel-shell-top-candidates') && tradeV4Src.includes('panel-shell-market-groups'), 'Q26 selected/top/market panels use matching bordered shells');
ok(tradeV4Src.includes('SELECTED COIN') && tradeV4Src.includes('TOP CANDIDATES') && tradeV4Src.includes('MARKET GROUPS'), 'Q27 scanner/right/sidebar panels render explicit headers');
ok(cssSrc.includes('grid-template-rows: minmax(340px, 50%) minmax(340px, 50%)'), 'Q28 center workspace rows are taller and balanced');
ok(openSrc.includes('table-scroll-both') && openSrc.includes('data-table-wide-open'), 'Q29 open positions table supports internal horizontal scroll');
ok(closedSrc.includes('table-scroll-both') && closedSrc.includes('data-table-wide-closed'), 'Q30 closed positions table supports internal horizontal scroll');
ok(openSrc.includes('Sort/Filter') && openSrc.includes('panel-filter-dropdown'), 'Q31 open positions has dropdown sort/filter control');
ok(closedSrc.includes('Sort/Filter') && closedSrc.includes('panel-filter-dropdown'), 'Q32 closed positions has dropdown sort/filter control');
ok(cssSrc.includes('.data-table-wide-open') && cssSrc.includes('.data-table-wide-closed') && cssSrc.includes('.table-scroll-both'), 'Q33 wide-table min-width and scrollbar styles are defined');

const many = Array.from({ length: 40 }).map((_, i) => ({
  candidateId: `c${i}`,
  symbol: `SYM${i}USDT`,
  price: 100 + Math.random() * 200,
  rank: i + 1,
  score: 100 + Math.random() * 200,
  confidenceSource: 'scanner_score_normalized',
  source: 'dipper',
  riskGroup: 'mid_cap',
  strategy: 'balanced',
  status: 'WAIT' as const,
  engineState: 'detected' as const,
  confidence: 60,
  spreadPct: 0.1,
  volumeRel: 1.1,
  dipPct: -0.2,
  reboundPct: 0.1,
  tpRoomPct: 2,
  momentum: 0.4,
  mainReason: 'ok',
  requiredNextAction: null,
  blockReasons: [],
  mlBadEntryRisk: 0,
  dataQuality: 'GOOD' as const,
  isOrderLocked: false,
}));
const airCoins = mapCandidatesToAirCoins({ candidates: many, openPositions: [], selectedSymbol: null, maxVisible: 24 });
ok(airCoins.length <= 24, 'J Air Scanner still renders max 24 visual coins');
ok(!tradePageSrc.includes('Classic Trade UI'), 'K Classic UI removed — 3D is master');
ok(!tradeV4Src.includes('mockData'), 'L no mockData imported by TradeV4Page');

// ── Score vs Confidence separation tests ──

ok(topSrc.includes('Symbol') && topSrc.includes('Price') && topSrc.includes('Trend') && topSrc.includes('Conf'), 'R1 Watch Pool renders Symbol, Price, Trend, Conf columns');
ok(topSrc.includes('Conf = confidence %'), 'R2 Legend explains Conf is confidence percentage');
ok(topSrc.includes('c.confidence') || topSrc.includes('confDisplay'), 'R3 Confidence is rendered in TopCandidatesPanel');
ok(!topSrc.includes('c.score != null'), 'R4 Score column removed from Watch Pool (now shows Price/Trend)');
ok(topSrc.includes('c.symbol.replace("USDT"'), 'R5 Coin column strips USDT suffix');
ok(topSrc.includes("c.status === 'BUY'") && topSrc.includes("status === 'WAIT'"), 'R6 Status column shows status only');

// Score/Conf separation still exists in SelectedCoinInspector
ok(selectedSrc.includes('label="Score"'), 'R7 Selected Coin SCORE shows tooltip explanation');
ok(selectedSrc.includes('label="Conf"'), 'R8 Selected Coin CONF shows tooltip explanation');

// AirCoin bubble: score labeled with S prefix
ok(airCoinSrc.includes('S{coin.score.toFixed(0)}'), 'R9 AirCoin bubble labels score with S prefix');
ok(airCoinSrc.includes('rank score, not confidence'), 'R10 AirCoin bubble tooltip explains score is ranking score');

// Data adapter uses rawScore for score
ok(adapterSrc.includes('candidate.rawScore'), 'R11 Data adapter reads rawScore for score');
ok(adapterSrc.includes('candidate.rank != null ? candidate.rank : null'), 'R12 Data adapter reads rank for position rank');

// Price field mapped from scanner
ok(adapterSrc.includes('candidate.price'), 'R13 Data adapter maps candidate price');

// Trend rendering in TopCandidatesPanel
ok(topSrc.includes('renderTrendLabel'), 'R14 Trend label helper used in Watch Pool');
ok(topSrc.includes('TREND_ARROW'), 'R15 Trend arrow characters defined');

// Reason line
ok(topSrc.includes('Reason:'), 'R16 Reason secondary line shown for candidates with mainReason');

console.log(`air-scanner-ui: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
