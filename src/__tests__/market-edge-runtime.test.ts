import assert from 'node:assert/strict';
import { MarketEdgeOutcomeTracker } from '../core/market-edge/MarketEdgeOutcomeTracker';
import { MarketEdgeRuntime } from '../core/market-edge/MarketEdgeRuntime';
import { buildMarketEdgeMappingsFromCanonicalSpotUniverse, buildMarketEdgeSymbolMappings } from '../core/market-edge/MarketEdgeSymbolMapper';
import { normalizeMarketEdgeMode } from '../core/market-edge/config';
import { MarketEdgePublicClient } from '../core/market-edge/MarketEdgePublicClient';
import { MarketEdgeDataAdapter, type MarketEdgeDataEvent } from '../core/market-edge/MarketEdgeDataAdapter';
import { readFileSync } from 'node:fs';

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => { await fn(); passed++; console.log(`PASS: ${name}`); };
const allEdgeRiskGroups = { top_caps: true, large_caps: true, mid_caps: true, high_risk: true, very_high_risk: true } as const;

await test('symbol mapper preserves SPOT_ONLY pairs instead of dropping them', () => {
  const spot = { symbols: [{ symbol: 'BTCUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true }, { symbol: 'ONLYUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true }] };
  const futures = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL' }] };
  const rows = buildMarketEdgeSymbolMappings(spot, futures);
  assert.equal(rows.find(row => row.spotSymbol === 'BTCUSDT')?.edgeAvailability, 'SPOT_AND_PERPETUAL');
  assert.equal(rows.find(row => row.spotSymbol === 'ONLYUSDT')?.edgeAvailability, 'SPOT_ONLY');
});

await test('canonical scanner universe maps known liquid pairs without a redundant Spot request', () => {
  const known = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'SUIUSDT'];
  const futures = { symbols: known.map(symbol => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL' })) };
  const rows = buildMarketEdgeMappingsFromCanonicalSpotUniverse(known, futures);
  assert.deepEqual(rows.map(row => row.spotSymbol), known);
  assert.ok(rows.every(row => row.hasPerpetualPair));
});

await test('legacy and case-insensitive Edge modes migrate deterministically', () => {
  assert.equal(normalizeMarketEdgeMode('advisory'), 'PRIORITY');
  assert.equal(normalizeMarketEdgeMode('shadow'), 'MONITOR');
  assert.equal(normalizeMarketEdgeMode('priority'), 'PRIORITY');
  assert.equal(normalizeMarketEdgeMode('OFF'), 'OFF');
});

await test('public client uses only public GET market-data endpoints and accounts OI separately', async () => {
  const urls: string[] = [];
  const client = new MarketEdgePublicClient((async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(String(input).includes('openInterest') ? { symbol: 'BTCUSDT', openInterest: '1', time: 1 } : { symbols: [] }), { status: 200 });
  }) as typeof fetch);
  await client.getSpotExchangeInfo(); await client.getFuturesExchangeInfo(); await client.getOpenInterest('BTCUSDT');
  assert.equal(client.getStats().edgePublicRequestCount, 3);
  assert.equal(client.getStats().edgeOIRequestCount, 1);
  assert.ok(Number.isFinite(client.getStats().edgeOIRequestsPerMinute));
  assert.ok(urls.every(url => !/order|account|position|leverage/i.test(new URL(url).pathname)));
});

await test('public client preserves the browser receiver for native fetch', async () => {
  const originalFetch = globalThis.fetch;
  let receiver: unknown = null;
  globalThis.fetch = (function (this: unknown) {
    receiver = this;
    return Promise.resolve(new Response(JSON.stringify({ symbols: [] }), { status: 200 }));
  }) as typeof fetch;
  try {
    const client = new MarketEdgePublicClient();
    await client.getFuturesExchangeInfo();
    assert.equal(receiver, globalThis);
    assert.equal(client.getStats().edgeRequestFailures, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('stream adapter normalizes public trades, depth, mark/index/funding and drops malformed updates', () => {
  const events: MarketEdgeDataEvent[] = [];
  const adapter = new MarketEdgeDataAdapter(event => events.push(event), null);
  const now = Date.now();
  (adapter as any).handleMessage(JSON.stringify({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', E: now, s: 'BTCUSDT', p: '100', q: '2', m: false } }), 'FUTURES');
  (adapter as any).handleMessage(JSON.stringify({ stream: 'btcusdt@depth10', data: { b: [['99', '3']], a: [['101', '2']] } }), 'FUTURES');
  (adapter as any).handleMessage(JSON.stringify({ data: { e: 'markPriceUpdate', E: now + 1, s: 'BTCUSDT', p: '100.5', i: '100', r: '0.0001' } }), 'FUTURES');
  (adapter as any).handleMessage('{bad-json', 'FUTURES');
  assert.equal(events.filter(event => event.type === 'TRADE').length, 1);
  assert.equal(events.filter(event => event.type === 'BOOK').length, 1);
  assert.equal(events.filter(event => event.type === 'PRICE').length, 3);
  assert.equal(events.filter(event => event.type === 'FUNDING').length, 1);
  assert.equal(adapter.getStats().edgeDroppedUpdates, 1);
});

await test('timestamp policy converts seconds, accepts milliseconds and rejects clock-domain mismatch', () => {
  const events: MarketEdgeDataEvent[] = [];
  const adapter = new MarketEdgeDataAdapter(event => events.push(event), null);
  const now = Date.now();
  (adapter as any).handleMessage(JSON.stringify({ data: { e: '24hrMiniTicker', E: Math.floor(now / 1_000), s: 'BTCUSDT', c: '100' } }), 'FUTURES');
  (adapter as any).handleMessage(JSON.stringify({ data: { e: '24hrMiniTicker', E: now + 1, s: 'ETHUSDT', c: '100' } }), 'FUTURES');
  (adapter as any).handleMessage(JSON.stringify({ data: { e: '24hrMiniTicker', E: 123, s: 'SOLUSDT', c: '100' } }), 'FUTURES');
  assert.equal(events.length, 2);
  assert.equal(adapter.getStats().timestampUnitCorrections, 2);
  assert.equal(adapter.getStats().timestampRejects, 1);
});

await test('adapter accepts real Spot depth shape and Futures bookTicker supplies the core perpetual price', () => {
  const events: MarketEdgeDataEvent[] = [];
  const adapter = new MarketEdgeDataAdapter(event => events.push(event), null);
  const now = Date.now();
  (adapter as any).handleMessage(JSON.stringify({ stream: 'btcusdt@depth10', data: { lastUpdateId: 1, bids: [['99', '3']], asks: [['101', '2']] } }), 'SPOT');
  (adapter as any).handleMessage(JSON.stringify({ stream: 'btcusdt@bookTicker', data: { e: 'bookTicker', E: now, s: 'BTCUSDT', b: '100', B: '2', a: '102', A: '3' } }), 'FUTURES');
  assert.equal(events.filter(event => event.type === 'BOOK' && event.venue === 'SPOT').length, 1);
  assert.equal(events.filter(event => event.type === 'BOOK' && event.venue === 'FUTURES').length, 1);
  assert.equal(events.filter(event => event.type === 'PRICE' && event.venue === 'PERP').length, 1);
});

await test('Futures subscriptions are bounded and one batch closing does not mark other open batches offline', () => {
  const sockets: any[] = [];
  const urls: string[] = [];
  const adapter = new MarketEdgeDataAdapter(() => {}, ((url: string) => {
    urls.push(url);
    const socket = { close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
    sockets.push(socket);
    return socket;
  }) as any);
  adapter.start(Array.from({ length: 60 }, (_, index) => `COIN${index}USDT`));
  assert.equal(urls.filter(url => url.includes('fstream.binance.com')).length, 2);
  assert.ok(urls.filter(url => url.includes('fstream.binance.com')).every(url => new URL(url).searchParams.get('streams')!.split('/').length <= 100));
  assert.ok(urls.every(url => !url.includes('!miniTicker@arr/!markPrice')));
  sockets.forEach(socket => socket.onopen?.());
  const futuresSockets = sockets.filter((_, index) => index > 0);
  futuresSockets[0].onclose?.();
  assert.equal(adapter.getStats().futuresConnected, true);
  adapter.stop();
});

await test('Futures disconnect has one bounded reconnect owner and recovers without page refresh', async () => {
  const sockets: any[] = [];
  const adapter = new MarketEdgeDataAdapter(() => {}, (() => {
    const socket = { close() {}, onopen: null, onmessage: null, onerror: null, onclose: null };
    sockets.push(socket);
    return socket;
  }) as any);
  adapter.start(['BTCUSDT']);
  sockets.forEach(socket => socket.onopen?.());
  sockets[1].onclose?.();
  assert.equal(adapter.getStats().futuresConnected, false);
  await new Promise(resolve => setTimeout(resolve, 1_100));
  assert.equal(adapter.getStats().edgeReconnectCount, 1);
  assert.equal(sockets.length, 4);
  sockets.slice(2).forEach(socket => socket.onopen?.());
  assert.equal(adapter.getStats().futuresConnected, true);
  adapter.stop();
});

await test('outcome tracker rejects lookahead and bounds duplicate signal frequency', () => {
  const tracker = new MarketEdgeOutcomeTracker(10, 60_000);
  assert.ok(tracker.recordSignal('BTCUSDT', 100_000, 100, 80));
  assert.equal(tracker.recordSignal('BTCUSDT', 101_000, 100, 81), null);
  tracker.ingestFuturePrice('BTCUSDT', 99_000, 200);
  tracker.ingestFuturePrice('BTCUSDT', 130_000, 101);
  tracker.ingestFuturePrice('BTCUSDT', 1_000_000, 102);
  const outcome = tracker.getOutcomes()[0];
  assert.equal(outcome.return30s, 1);
  assert.equal(outcome.maxFutureExcursionPct, 2);
  assert.equal(outcome.return15m, 2);
  assert.equal(tracker.getStats().bounded, true);
  const summary = tracker.getSummary();
  assert.equal(summary.completed, 1);
  assert.equal(summary.buckets.find(row => row.scoreBucket === '80-89')?.averageReturn30s, 1);
  assert.equal(summary.buckets.find(row => row.scoreBucket === '80-89')?.positive5mRate, 1);
  assert.equal(summary.buckets.find(row => row.scoreBucket === '80-89')?.hit1PctBeforeMinus1PctRate, 1);
  assert.equal(summary.buckets.find(row => row.scoreBucket === '80-89')?.hit3PctBeforeMinus1PctRate, 0);
});

await test('Futures mapping failure degrades Edge without throwing into caller', async () => {
  const failingClient = {
    getSpotExchangeInfo: async () => ({ symbols: [] }),
    getFuturesExchangeInfo: async () => { throw new Error('futures_offline'); },
    getOpenInterest: async () => { throw new Error('offline'); },
    getStats: () => ({ edgePublicRequestCount: 1, edgeOIRequestCount: 0, edgeRequestFailures: 1 }),
  };
  const adapter = { start() {}, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0 }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR', riskGroups: allEdgeRiskGroups }, undefined, { publicClient: failingClient as any, dataAdapter: adapter as any });
  await runtime.start(['BTCUSDT']);
  assert.equal(runtime.getState().health, 'EDGE_OFFLINE');
  assert.equal(runtime.getState().failureReason, 'futures_offline');
  runtime.stop();
});

await test('runtime initialization never refetches Spot exchangeInfo', async () => {
  const futuresInfo = { symbols: [{ symbol: 'BTCUSDT', status: 'TRADING', contractType: 'PERPETUAL' }] };
  const client = {
    getSpotExchangeInfo: async () => { throw new Error('must_not_be_called'); },
    getFuturesExchangeInfo: async () => futuresInfo,
    getOpenInterest: async () => ({ symbol: 'BTCUSDT', openInterest: '1', time: Date.now() }),
    getAllPremiumIndexes: async () => [],
    getStats: () => ({ edgePublicRequestCount: 1, edgeOIRequestCount: 0, edgeRequestFailures: 0 }),
  };
  let starts = 0;
  const adapter = { start() { starts++; }, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0, futuresConnected: false }) };
  const runtime = new MarketEdgeRuntime({ mode: 'PRIORITY', riskGroups: allEdgeRiskGroups }, undefined, { publicClient: client as any, dataAdapter: adapter as any });
  await runtime.start(['BTCUSDT']);
  assert.equal(starts, 1);
  assert.equal(runtime.getState().perpetualSymbols, 1);
  runtime.stop();
});

await test('stop invalidates an in-flight initialization and prevents zombie timers or streams', async () => {
  let resolveInfo!: (value: unknown) => void;
  const delayedInfo = new Promise(resolve => { resolveInfo = resolve; });
  let adapterStarts = 0;
  const client = {
    getSpotExchangeInfo: async () => delayedInfo,
    getFuturesExchangeInfo: async () => delayedInfo,
    getOpenInterest: async () => ({ openInterest: '1', time: Date.now() }),
    getStats: () => ({ edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0 }),
  };
  const adapter = { start() { adapterStarts++; }, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0 }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR', riskGroups: allEdgeRiskGroups }, undefined, { publicClient: client as any, dataAdapter: adapter as any });
  const starting = runtime.start(['BTCUSDT']);
  runtime.stop();
  resolveInfo({ symbols: [] });
  await starting;
  assert.equal(adapterStarts, 0);
  assert.equal(runtime.getState().health, 'EDGE_OFFLINE');
});

await test('MONITOR can never request PRIORITY reanalysis', async () => {
  let priorityCalls = 0;
  const info = { symbols: [{ symbol: 'BTCUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, contractType: 'PERPETUAL' }] };
  const client = { getSpotExchangeInfo: async () => info, getFuturesExchangeInfo: async () => info, getOpenInterest: async () => ({ symbol: 'BTCUSDT', openInterest: '100', time: Date.now() }), getStats: () => ({ edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0 }) };
  const adapter = { start() {}, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0 }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR', minimumWarmupMs: 0, riskGroups: allEdgeRiskGroups }, () => { priorityCalls++; }, { publicClient: client as any, dataAdapter: adapter as any });
  await runtime.start(['BTCUSDT']);
  (runtime as any).maybeRequestPriority();
  assert.equal(priorityCalls, 0);
  runtime.stop();
});

await test('all-market streams are filtered to the canonical scanner universe before allocating state', async () => {
  const info = { symbols: [{ symbol: 'BTCUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, contractType: 'PERPETUAL' }] };
  const client = { getSpotExchangeInfo: async () => info, getFuturesExchangeInfo: async () => info, getOpenInterest: async () => ({ symbol: 'BTCUSDT', openInterest: '100', time: Date.now() }), getStats: () => ({ edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0, edgePublicRequestsPerMinute: 0, edgeOIRequestsPerMinute: 0 }) };
  const adapter = { start() {}, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0, edgeWebSocketMessagesPerSecond: 0 }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR', riskGroups: allEdgeRiskGroups }, undefined, { publicClient: client as any, dataAdapter: adapter as any });
  await runtime.start(['BTCUSDT']);
  (runtime as any).onData({ type: 'PRICE', symbol: 'ETHUSDT', venue: 'SPOT', value: 10, eventTime: 1, receivedAt: 1 });
  (runtime as any).onData({ type: 'PRICE', symbol: 'BTCUSDT', venue: 'SPOT', value: 10, eventTime: 1, receivedAt: 1 });
  assert.equal(runtime.getMemoryStats().symbols, 1);
  runtime.stop();
});

await test('universe membership updates incrementally without restarting streams or losing all rolling state', async () => {
  const info = { symbols: [
    { symbol: 'BTCUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, contractType: 'PERPETUAL' },
    { symbol: 'ETHUSDT', quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, contractType: 'PERPETUAL' },
  ] };
  let starts = 0, stops = 0;
  const client = { getSpotExchangeInfo: async () => info, getFuturesExchangeInfo: async () => info, getOpenInterest: async (symbol: string) => ({ symbol, openInterest: '100', time: Date.now() }), getStats: () => ({ edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0, edgePublicRequestsPerMinute: 0, edgeOIRequestsPerMinute: 0 }) };
  const adapter = { start() { starts++; }, stop() { stops++; }, updateDetailedSymbols() {}, updateBaselineSymbols() {}, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0, edgeWebSocketMessagesPerSecond: 0 }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR', riskGroups: allEdgeRiskGroups }, undefined, { publicClient: client as any, dataAdapter: adapter as any });
  await runtime.start(['BTCUSDT']);
  (runtime as any).onData({ type: 'PRICE', symbol: 'BTCUSDT', venue: 'SPOT', value: 10, eventTime: 1, receivedAt: 1 });
  await runtime.updateUniverse(['ETHUSDT']);
  (runtime as any).onData({ type: 'PRICE', symbol: 'ETHUSDT', venue: 'SPOT', value: 20, eventTime: 2, receivedAt: 2 });
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  assert.equal(runtime.getMemoryStats().symbols, 1);
  runtime.stop();
});

await test('default Edge markets include only High Risk and Very High Risk symbols', async () => {
  const symbols = ['BTCUSDT', 'DOGEUSDT', 'MEMEUSDT'];
  const info = { symbols: symbols.map(symbol => ({ symbol, quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, contractType: 'PERPETUAL' })) };
  const client = { getFuturesExchangeInfo: async () => info, getOpenInterest: async (symbol: string) => ({ symbol, openInterest: '100', time: Date.now() }), getAllPremiumIndexes: async () => [], getStats: () => ({ edgePublicRequestCount: 0, edgeOIRequestCount: 0, edgeRequestFailures: 0, edgePublicRequestsPerMinute: 0, edgeOIRequestsPerMinute: 0 }) };
  let baselineSymbols: string[] = [];
  const adapter = { start(next: string[]) { baselineSymbols = next; }, stop() {}, updateDetailedSymbols() {}, updateBaselineSymbols(next: string[]) { baselineSymbols = next; }, getStats: () => ({ edgeReconnectCount: 0, edgeDroppedUpdates: 0, edgeMessagesReceived: 0, socketsOpen: 0, edgeWebSocketMessagesPerSecond: 0, futuresConnected: false }) };
  const runtime = new MarketEdgeRuntime({ mode: 'MONITOR' }, undefined, { publicClient: client as any, dataAdapter: adapter as any });
  await runtime.start(symbols);
  assert.deepEqual(runtime.getState().selectedRiskGroups, ['high_risk', 'very_high_risk']);
  assert.equal(runtime.getState().sourceUniverseSize, 3);
  assert.deepEqual(baselineSymbols.sort(), ['DOGEUSDT', 'MEMEUSDT']);
  assert.equal(runtime.getState().mappedSymbols, 2);
  runtime.updateConfig({ riskGroups: { top_caps: true, large_caps: false, mid_caps: false, high_risk: false, very_high_risk: false } });
  assert.deepEqual(runtime.getState().selectedRiskGroups, ['top_caps']);
  assert.deepEqual(baselineSymbols, ['BTCUSDT']);
  assert.equal(runtime.getState().mappedSymbols, 1);
  runtime.stop();
});

await test('Market Edge source contains no Futures order or private endpoint', () => {
  const publicSource = readFileSync('src/core/market-edge/MarketEdgePublicClient.ts', 'utf8');
  const adapterSource = readFileSync('src/core/market-edge/MarketEdgeDataAdapter.ts', 'utf8');
  assert.ok(!/\/fapi\/v\d+\/(order|leverage|position|account)/i.test(publicSource + adapterSource));
  assert.ok(!/method\s*:\s*['"]POST['"]/i.test(publicSource + adapterSource));
});

await test('application lifecycle forwards CUSTOM and automatic scanner universes without Trade-page ownership', () => {
  const appSource = readFileSync('src/App.tsx', 'utf8');
  const callbackStart = appSource.indexOf('onCandidatesReady: (snapshot) =>');
  const callbackBody = appSource.slice(callbackStart, callbackStart + 500);
  assert.ok(callbackBody.includes('marketEdgeRuntime.updateUniverse'));
  assert.ok(!callbackBody.includes("snapshot.universeMode !== 'CUSTOM'"));
});

console.log(`market-edge-runtime: ${passed} passed, 0 failed`);
