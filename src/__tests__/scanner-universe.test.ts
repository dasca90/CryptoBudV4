import { buildScannerUniverse } from '../core/scanner/scanner-universe';
import { filterScannerUniverse, isScannerBannedSymbol } from '../core/scanner/scanner-ban-filter';
import { parseSymbolFilters } from '../core/market-data/symbol-filters';
import { getEffectiveScannerUniverseSize, normalizeScannerUniverseSize, parseScannerUniverseSize, resolveScannerUniverseSizeDraft } from '../core/scanner/scanner-universe-config';
import { readFileSync } from 'node:fs';
import { MarketScanner } from '../core/scanner/MarketScanner';

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string) {
  if (condition) { passed++; console.log(`  OK ${msg}`); }
  else { failed++; console.error(`  FAIL ${msg}`); }
}

function makeExchangeSymbol(symbol: string, baseAsset: string, quoteAsset = 'USDT', status = 'TRADING', isSpotTradingAllowed = true, withFilters = true) {
  const filters = withFilters
    ? [
      { filterType: 'PRICE_FILTER', minPrice: '0.0001', maxPrice: '1000000', tickSize: '0.0001' },
      { filterType: 'LOT_SIZE', minQty: '0.0001', maxQty: '1000000', stepSize: '0.0001' },
      { filterType: 'MIN_NOTIONAL', minNotional: '5' },
    ]
    : [];
  return {
    symbol,
    status,
    baseAsset,
    quoteAsset,
    isSpotTradingAllowed,
    quotePrecision: 8,
    baseAssetPrecision: 8,
    quoteAssetPrecision: 8,
    filters,
  };
}

async function main() {
  const exchangeInfo: Record<string, unknown> = {
    symbols: [
      makeExchangeSymbol('BTCUSDT', 'BTC'),
      makeExchangeSymbol('BTCEUR', 'BTC', 'EUR'),
      makeExchangeSymbol('USDCUSDT', 'USDC'),
      makeExchangeSymbol('FDUSDUSDT', 'FDUSD'),
      makeExchangeSymbol('EURUSDT', 'EUR'),
      makeExchangeSymbol('GBPUSDT', 'GBP'),
      makeExchangeSymbol('PAXGUSDT', 'PAXG'),
      makeExchangeSymbol('XAUTUSDT', 'XAUT'),
      makeExchangeSymbol('WBTCUSDT', 'WBTC'),
      makeExchangeSymbol('BTCBUSDT', 'BTCB'),
      makeExchangeSymbol('ETHUSDT', 'ETH'),
      makeExchangeSymbol('WETHUSDT', 'WETH'),
      makeExchangeSymbol('WBETHUSDT', 'WBETH'),
      makeExchangeSymbol('BADSTATUUSDT', 'BAD', 'USDT', 'BREAK'),
      makeExchangeSymbol('NOSPOTUSDT', 'NOSPOT', 'USDT', 'TRADING', false),
      makeExchangeSymbol('NOFILTERUSDT', 'NOFILTER', 'USDT', 'TRADING', true, false),
      makeExchangeSymbol('SOLUSDT', 'SOL'),
      makeExchangeSymbol('ADAUSDT', 'ADA'),
      makeExchangeSymbol('RLUSDUSDT', 'RLUSD'),
      makeExchangeSymbol('XUSDUSDT', 'XUSD'),
    ],
  };

  const tickers = [
    { symbol: 'BTCUSDT', quoteVolume: '1000' },
    { symbol: 'SOLUSDT', quoteVolume: '900' },
    { symbol: 'ADAUSDT', quoteVolume: '800' },
    { symbol: 'USDCUSDT', quoteVolume: '700' },
    { symbol: 'WBTCUSDT', quoteVolume: '600' },
    { symbol: 'ETHUSDT', quoteVolume: '500' },
    { symbol: 'BTCEUR', quoteVolume: '400' },
  ] as Record<string, unknown>[];

  const f0 = parseSymbolFilters('BTCEUR', exchangeInfo);
  const b0 = isScannerBannedSymbol('BTCEUR', f0, {});
  assert(b0.banned && b0.reason === 'NON_USDT_QUOTE', 'B only USDT quote accepted');

  const filtered = filterScannerUniverse((exchangeInfo.symbols as Record<string, unknown>[]).map(s => String(s.symbol)), exchangeInfo, tickers, {
    manualScannerBanlist: ['ADAUSDT'],
  });

  assert(filtered.symbols.length <= (exchangeInfo.symbols as unknown[]).length, 'A filter returns only available eligible symbols');
  assert(filtered.banned.some(b => b.symbol === 'USDCUSDT' && b.reason === 'STABLECOIN_PAIR'), 'C stablecoin pair banned');
  assert(filtered.banned.some(b => b.symbol === 'FDUSDUSDT' && b.reason === 'STABLECOIN_PAIR'), 'C stablecoin pair banned 2');
  assert(filtered.banned.some(b => b.symbol === 'RLUSDUSDT' && b.reason === 'STABLECOIN_PAIR'), 'O RLUSDUSDT banned as STABLECOIN_PAIR');
  assert(filtered.banned.some(b => b.symbol === 'XUSDUSDT' && b.reason === 'STABLECOIN_PAIR'), 'P XUSDUSDT banned as STABLECOIN_PAIR');
  assert(filtered.banned.some(b => b.symbol === 'EURUSDT' && b.reason === 'FIAT_PAIR'), 'D fiat pair banned');
  assert(filtered.banned.some(b => b.symbol === 'GBPUSDT' && b.reason === 'FIAT_PAIR'), 'D fiat pair banned 2');
  assert(filtered.banned.some(b => b.symbol === 'PAXGUSDT' && b.reason === 'METAL_PAIR'), 'E metal pair banned');
  assert(filtered.banned.some(b => b.symbol === 'XAUTUSDT' && b.reason === 'METAL_PAIR'), 'E metal pair banned 2');
  assert(filtered.symbols.includes('BTCUSDT'), 'F BTCUSDT allowed');
  assert(filtered.banned.some(b => b.symbol === 'WBTCUSDT' && b.reason === 'WRAPPED_BTC_PAIR'), 'F wrapped BTC banned');
  assert(filtered.banned.some(b => b.symbol === 'BTCBUSDT' && b.reason === 'WRAPPED_BTC_PAIR'), 'F wrapped BTC variant banned');
  assert(filtered.symbols.includes('ETHUSDT'), 'G ETHUSDT allowed');
  assert(filtered.banned.some(b => b.symbol === 'WETHUSDT' && b.reason === 'WRAPPED_ETH_PAIR'), 'G wrapped ETH banned');
  assert(filtered.banned.some(b => b.symbol === 'WBETHUSDT' && b.reason === 'WRAPPED_ETH_PAIR'), 'G wrapped ETH variant banned');
  assert(filtered.banned.some(b => b.symbol === 'BADSTATUUSDT' && b.reason === 'SYMBOL_STATUS_NOT_TRADING'), 'H non-trading symbol banned');
  assert(filtered.banned.some(b => b.symbol === 'NOFILTERUSDT' && b.reason === 'MISSING_SYMBOL_FILTERS'), 'I missing filters banned');
  assert(filtered.banned.some(b => b.symbol === 'ADAUSDT' && b.reason === 'MANUAL_BANLIST'), 'J manual banlist bans symbol');

  const allowedWithVolumes = filtered.symbols
    .map(s => ({ symbol: s, qv: Number((tickers.find(t => t.symbol === s) ?? { quoteVolume: 0 }).quoteVolume) }))
    .sort((a, b) => b.qv - a.qv);
  assert(allowedWithVolumes[0]?.symbol === 'BTCUSDT', 'K sorted by quoteVolume desc after filtering');
  assert((filtered.reasonCounts.STABLECOIN_PAIR ?? 0) >= 2, 'L diagnostics stablecoin count');
  assert((filtered.reasonCounts.FIAT_PAIR ?? 0) >= 2, 'L diagnostics fiat count');

  // Build BINANCE_TOP_250 path with mocked fetch
  const originalFetch = globalThis.fetch;
  const manyExchangeSymbols = Array.from({ length: 430 }).map((_, i) => makeExchangeSymbol(`C${i}USDT`, `C${i}`));
  const largeExchangeInfo = { symbols: [...(exchangeInfo.symbols as Record<string, unknown>[]), ...manyExchangeSymbols] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/v3/exchangeInfo')) {
      return new Response(JSON.stringify(largeExchangeInfo), { status: 200 });
    }
    if (url.includes('/api/v3/ticker/24hr')) {
      const many = Array.from({ length: 430 }).map((_, i) => ({ symbol: `C${i}USDT`, quoteVolume: String(2000 - i) }));
      const merged = [...tickers, ...many];
      return new Response(JSON.stringify(merged), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const configured500 = await buildScannerUniverse('BINANCE_TOP_250', [], { maxSymbols: 500, manualScannerBanlist: ['C1USDT'] });
  assert(configured500.symbols.length > 250, 'A configured 500 is not artificially capped at 250');
  assert(configured500.symbols.length === configured500.eligibleUniverseAvailable, 'A configured 500 uses every currently eligible symbol when fewer are available');
  const configured200 = await buildScannerUniverse('BINANCE_TOP_250', [], { maxSymbols: 200, manualScannerBanlist: ['C1USDT'] });
  assert(configured200.symbols.length === 200, 'A configured 200 limits an eligible universe above 200');
  const configured1000 = await buildScannerUniverse('BINANCE_TOP_250', [], { maxSymbols: 1000, manualScannerBanlist: ['C1USDT'] });
  assert(configured1000.symbols.length === configured1000.eligibleUniverseAvailable, 'A configured 1000 remains persisted/effective only to availability');
  assert(!configured500.symbols.includes('USDCUSDT') && !configured500.symbols.includes('WBTCUSDT'), 'A blocked assets remain excluded above size 250');

  assert(normalizeScannerUniverseSize(50) === 50 && normalizeScannerUniverseSize(100) === 100 && normalizeScannerUniverseSize(150) === 150, 'R common editable values are accepted');
  assert(normalizeScannerUniverseSize(250) === 250 && normalizeScannerUniverseSize(300) === 300 && normalizeScannerUniverseSize(400) === 400 && normalizeScannerUniverseSize(500) === 500, 'R values at and above legacy 250 are accepted exactly');
  assert(getEffectiveScannerUniverseSize(400, 350) === 350 && getEffectiveScannerUniverseSize(200, 350) === 200 && getEffectiveScannerUniverseSize(500, 430) === 430, 'R effective size is min configured and eligible availability');
  assert(resolveScannerUniverseSizeDraft('').draft === '' && resolveScannerUniverseSizeDraft('').value === null, 'R temporary empty input remains empty and does not restore a default');
  assert([0, -10, 50.5, 'invalid'].every(value => parseScannerUniverseSize(value) === null), 'R invalid sizes are rejected instead of entering runtime');
  const scanner = new MarketScanner();
  scanner.setScannerRankingConfig({ maxSymbolsScanned: 400, source: 'test' });
  scanner.setScannerRankingConfig({ maxSymbolsScanned: 50.5, source: 'test_invalid' });
  assert(scanner.getRuntimeSettingsDiagnostics().configuredUniverseSize === 400, 'R invalid runtime update preserves the previous valid configured value');
  const scannerSource = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  assert(scannerSource.includes('const configuredUniverseSizeForScan = this.maxSymbolsScanned') && scannerSource.includes('maxSymbols: configuredUniverseSizeForScan'), 'R active scan captures an immutable configured-size snapshot');
  const cardSource = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
  assert(cardSource.includes('value={universeSizeDraft}') && cardSource.includes('min={1}') && !cardSource.includes('max={250}'), 'R UI keeps an editable draft with no legacy maximum');
  const onlyTopCaps = await buildScannerUniverse('TOP_50', [], {
    enabledRiskGroups: { top_caps: true, large_caps: false, mid_caps: false, high_risk: false, very_high_risk: false },
  });
  assert(onlyTopCaps.symbols.every(s => {
    const g = (s === 'BTCUSDT' || s === 'ETHUSDT' || s === 'BNBUSDT' || s === 'SOLUSDT' || s === 'ADAUSDT' || s === 'XRPUSDT' || s === 'AVAXUSDT' || s === 'DOTUSDT' || s === 'LINKUSDT' || s === 'MATICUSDT' || s === 'UNIUSDT' || s === 'LTCUSDT' || s === 'ATOMUSDT' || s === 'ETCUSDT' || s === 'XLMUSDT' || s === 'FILUSDT' || s === 'TRXUSDT' || s === 'NEARUSDT') ? 'top_caps' : 'other';
    return g === 'top_caps';
  }), 'M disabled risk groups are excluded');
  const invalidFiltered = await buildScannerUniverse('CUSTOM', ['BTCUSDT', 'BAD🙂USDT', 'ETHUSDT', 'A!USDT'], {
    enabledRiskGroups: { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true },
  });
  assert(invalidFiltered.symbols.every(s => /^[A-Z0-9]+USDT$/.test(s)), 'N invalid unicode/non-alnum symbols filtered before candidates');

  // Verify INVALID_SYMBOL_FORMAT in filterScannerUniverse
  const formatFiltered = filterScannerUniverse(['BTCUSDT', '币安人生USDT', 'BAD🙂USDT', 'ETHUSDT'], exchangeInfo, []);
  assert(formatFiltered.symbols.includes('BTCUSDT'), 'Q BTCUSDT passes filter');
  assert(formatFiltered.symbols.includes('ETHUSDT'), 'Q ETHUSDT passes filter');
  assert(!formatFiltered.symbols.includes('币安人生USDT'), 'Q unicode 币安人生USDT filtered out');
  assert(!formatFiltered.symbols.includes('BAD🙂USDT'), 'Q emoji BAD🙂USDT filtered out');
  assert((formatFiltered.reasonCounts.INVALID_SYMBOL_FORMAT ?? 0) >= 2, 'Q INVALID_SYMBOL_FORMAT count >= 2');

  globalThis.fetch = originalFetch;

  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
