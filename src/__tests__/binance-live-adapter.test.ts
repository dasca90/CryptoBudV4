import { LiveBinanceAdapter } from '../core/exchange/LiveBinanceAdapter';
import { BinancePrivateClient, BinancePrivateError, hmacSha256Hex } from '../core/exchange/BinancePrivateClient';
import { normalizeBinanceExecutionReport, normalizeBinanceOrder } from '../core/exchange/BinanceOrderNormalizer';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import type { OrderResult, SymbolFilters } from '../core/types';

let passed = 0;
let failed = 0;
function ok(condition: unknown, label: string) { if (condition) { passed++; console.log(`PASS ${label}`); } else { failed++; console.error(`FAIL ${label}`); } }

const credentials = { apiKey: 'test-key-never-real', apiSecret: 'test-secret-never-real' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const filters: SymbolFilters = {
  symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', minNotional: 10,
  minQty: 0.00001, maxQty: 100, stepSize: 0.00001, marketMinQty: 0.00001, marketMaxQty: 10,
  marketStepSize: 0.00001, tickSize: 0.01, minPrice: 0.01, maxPrice: 1_000_000,
  quotePrecision: 8, baseAssetPrecision: 8, quoteAssetPrecision: 8, isSpotTradingAllowed: true,
};
MarketDataFeed.getInstance().setSymbolFilters('BTCUSDT', filters);
MarketDataFeed.getInstance().setManualPrice('BTCUSDT', 50_000);

function account() {
  return { canTrade: true, accountType: 'SPOT', permissions: ['SPOT'], updateTime: 123, balances: [{ asset: 'USDT', free: '100.5', locked: '2.5' }] };
}
function order(status: string, executedQty = '0', quoteQty = '0') {
  return { symbol: 'BTCUSDT', orderId: 42, clientOrderId: 'CB6-BUY-BTCUSDT-test', side: 'BUY', status, origQty: '0.002', executedQty, cummulativeQuoteQty: quoteQty, transactTime: 1234, updateTime: 1235 };
}

async function main() {
  const signature = await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
  ok(signature === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'HMAC SHA256 signing uses the canonical digest');

  const statuses: Array<[string, OrderResult['status']]> = [['NEW', 'new'], ['PARTIALLY_FILLED', 'partially_filled'], ['FILLED', 'filled'], ['CANCELED', 'cancelled'], ['EXPIRED', 'expired'], ['REJECTED', 'rejected']];
  for (const [raw, expected] of statuses) ok(normalizeBinanceOrder(order(raw)).status === expected, `normalizes order ${raw}`);
  const filled = normalizeBinanceOrder(order('FILLED', '0.002', '101'));
  ok(filled.price === 50_500 && filled.quantity === 0.002 && filled.remainingQuantity === 0, 'uses cumulative exchange quantity and average fill price');

  let accountCalls = 0;
  const successFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v3/time') return json({ serverTime: Date.now() + 250 });
    if (url.pathname === '/api/v3/account') { accountCalls++; return json(account()); }
    if (url.pathname === '/api/v3/order' && url.searchParams.has('origClientOrderId')) return json({ code: -2013, msg: 'Order does not exist.' }, 400);
    if (url.pathname === '/api/v3/order') return json(order('FILLED', '0.002', '101'));
    return json([]);
  };
  const adapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', { credentialsProvider: async () => credentials, fetchImpl: successFetch, startPrivateStream: false });
  await adapter.connect();
  ok((await adapter.getAccountInfo()).canTrade && accountCalls >= 2, 'signed account read success and Spot permission');
  const balances = await adapter.getBalances();
  ok(balances[0].free === 100.5 && balances[0].locked === 2.5, 'balance read success uses numeric free and locked values');
  const submitted = await adapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.002, mode: 'AUTO', clientOrderId: 'CB6-BUY-BTCUSDT-test' });
  ok(submitted.status === 'filled' && submitted.price === 50_500, 'MARKET BUY submission is normalized');
  let sellSubmitted = false;
  const sellAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', { credentialsProvider: async () => credentials, startPrivateStream: false, fetchImpl: async (input) => {
    const url = new URL(String(input)); if (url.pathname === '/api/v3/time') return json({ serverTime: Date.now() }); if (url.pathname === '/api/v3/account') return json(account());
    sellSubmitted = url.searchParams.get('side') === 'SELL' && url.searchParams.get('type') === 'MARKET'; return json({ ...order('FILLED', '0.002', '99'), side: 'SELL', clientOrderId: 'CB6-SELL-BTCUSDT-test' });
  } });
  await sellAdapter.connect();
  const sold = await sellAdapter.submitOrder({ coin: 'BTCUSDT', side: 'SELL', quantity: 0.002, mode: 'AUTO', clientOrderId: 'CB6-SELL-BTCUSDT-test' });
  ok(sellSubmitted && sold.side === 'SELL' && sold.price === 49_500, 'MARKET SELL submission uses the same canonical adapter and actual fill price');
  const queriedByClient = await adapter.getOrder('BTCUSDT', undefined, 'missing-client-id');
  ok(queriedByClient === null, 'order query by clientOrderId normalizes Binance -2013 to not found');
  const queriedByOrder = await adapter.getOrder('BTCUSDT', '42');
  ok(queriedByOrder?.orderId === '42', 'order query by exchange orderId works');
  const metrics = adapter.getPrivateMetrics();
  ok(metrics.privateRequestCount >= 5 && metrics.orderQueryCount === 2 && metrics.accountQueryCount >= 3, 'private request budget metrics are tracked');

  const errorCases: Array<[number, number, string, BinancePrivateError['category']]> = [
    [401, -2015, 'Invalid API-key, IP, or permissions for action.', 'AUTH_FAILED'],
    [400, -1022, 'Signature for this request is not valid.', 'SIGNATURE_INVALID'],
    [403, -2015, 'Permission denied', 'AUTH_FAILED'],
    [429, -1003, 'Too many requests', 'RATE_LIMITED'],
    [400, -2010, 'Filter failure: LOT_SIZE', 'FILTER_REJECTED'],
  ];
  for (const [http, code, msg, category] of errorCases) {
    const client = new BinancePrivateClient(async () => credentials, async () => json({ code, msg }, http));
    try { await client.signedRequest('GET', '/api/v3/account', {}, { endpointClass: 'account', allowTimestampRetry: false }); ok(false, `error ${category} throws`); }
    catch (error) { ok(error instanceof BinancePrivateError && error.category === category, `normalizes ${category}`); }
  }

  let driftStep = 0;
  const driftClient = new BinancePrivateClient(async () => credentials, async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v3/time') return json({ serverTime: Date.now() + 1500 });
    driftStep++;
    return driftStep === 1 ? json({ code: -1021, msg: 'Timestamp outside recvWindow' }, 400) : json(account());
  });
  await driftClient.signedRequest('GET', '/api/v3/account', {}, { endpointClass: 'account' });
  ok(driftStep === 2 && driftClient.getTimeState().lastServerTimeSyncAt > 0, 'timestamp drift syncs time and retries a safe account read exactly once');

  let submitCalls = 0;
  const noRetryAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', {
    credentialsProvider: async () => credentials, startPrivateStream: false,
    fetchImpl: async (input) => { const path = new URL(String(input)).pathname; if (path === '/api/v3/time') return json({ serverTime: Date.now() }); if (path === '/api/v3/account') return json(account()); submitCalls++; return json({ code: -1021, msg: 'Timestamp outside recvWindow' }, 400); },
  });
  await noRetryAdapter.connect();
  try { await noRetryAdapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.002, mode: 'AUTO', clientOrderId: 'CB6-BUY-BTCUSDT-noretry' }); } catch { /* expected */ }
  ok(submitCalls === 1, 'order submission is never retried after a timestamp/unknown outcome');

  let timedOutSubmitCalls = 0;
  const timeoutAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', {
    credentialsProvider: async () => credentials, startPrivateStream: false, requestTimeoutMs: 10,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3/time') return json({ serverTime: Date.now() });
      if (url.pathname === '/api/v3/account') return json(account());
      if (url.pathname === '/api/v3/order' && url.searchParams.has('origClientOrderId')) return json(order('FILLED', '0.002', '101'));
      timedOutSubmitCalls++;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    },
  });
  await timeoutAdapter.connect();
  try { await timeoutAdapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.002, mode: 'AUTO', clientOrderId: 'CB6-BUY-BTCUSDT-timeout' }); ok(false, 'timeout throws unknown result'); }
  catch (error) { ok(error instanceof BinancePrivateError && error.category === 'REQUEST_TIMEOUT', 'submit timeout is classified REQUEST_TIMEOUT/unknown'); }
  ok(timedOutSubmitCalls === 1, 'submit timeout causes no blind retry');
  ok((await timeoutAdapter.getOrder('BTCUSDT', undefined, 'CB6-BUY-BTCUSDT-timeout'))?.status === 'filled', 'timeout can recover original FILLED order by clientOrderId');

  for (const [status, expected] of [['NEW', 'new'], ['PARTIALLY_FILLED', 'partially_filled']] as const) {
    const recoveryAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', { credentialsProvider: async () => credentials, startPrivateStream: false, fetchImpl: async (input) => {
      const path = new URL(String(input)).pathname; if (path === '/api/v3/time') return json({ serverTime: Date.now() }); if (path === '/api/v3/account') return json(account()); return json(order(status, status === 'PARTIALLY_FILLED' ? '0.001' : '0', status === 'PARTIALLY_FILLED' ? '50' : '0'));
    } });
    await recoveryAdapter.connect();
    ok((await recoveryAdapter.getOrder('BTCUSDT', undefined, `recover-${status}`))?.status === expected, `timeout query recovery supports ${status}`);
  }

  let filterNetworkCalls = 0;
  const filterAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', { credentialsProvider: async () => credentials, startPrivateStream: false, fetchImpl: async (input) => {
    const path = new URL(String(input)).pathname; if (path === '/api/v3/time') return json({ serverTime: Date.now() }); if (path === '/api/v3/account') return json(account()); filterNetworkCalls++; return json(order('NEW'));
  } });
  await filterAdapter.connect();
  try { await filterAdapter.submitOrder({ coin: 'BTCUSDT', side: 'BUY', quantity: 0.00001, mode: 'AUTO', clientOrderId: 'CB6-filter' }); } catch (error) { ok(error instanceof BinancePrivateError && error.category === 'FILTER_REJECTED', 'local min-notional filter rejection is fail-closed'); }
  ok(filterNetworkCalls === 0, 'filter-rejected order never reaches Binance submit endpoint');

  const partialEvent = normalizeBinanceExecutionReport({ e: 'executionReport', s: 'BTCUSDT', i: 42, c: 'CB6-x', S: 'BUY', X: 'PARTIALLY_FILLED', q: '2', z: '1', Z: '50000', E: 99 });
  ok(partialEvent.status === 'partially_filled' && partialEvent.price === 50_000, 'private execution event uses canonical normalizer');
  const duplicateA = normalizeBinanceExecutionReport({ e: 'executionReport', s: 'BTCUSDT', i: 42, c: 'CB6-x', S: 'BUY', X: 'FILLED', q: '2', z: '2', Z: '100000', E: 100 });
  const duplicateB = normalizeBinanceExecutionReport({ e: 'executionReport', s: 'BTCUSDT', i: 42, c: 'CB6-x', S: 'BUY', X: 'FILLED', q: '2', z: '2', Z: '100000', E: 100 });
  ok(JSON.stringify(duplicateA) === JSON.stringify(duplicateB), 'duplicate ACK/FILLED events normalize deterministically for lifecycle idempotency');
  ok(normalizeBinanceExecutionReport({ s: 'BTCUSDT', i: 42, c: 'x', S: 'SELL', X: 'CANCELED', q: '2', z: '1', Z: '50000' }).status === 'cancelled', 'partial then canceled preserves canceled exchange state with executed quantity');

  class FakeSocket {
    onopen: ((event: Event) => void) | null = null; onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null; onclose: ((event: CloseEvent) => void) | null = null;
    sent: string[] = []; send(value: string) { this.sent.push(value); } close() { this.onclose?.({} as CloseEvent); }
    open() { this.onopen?.({} as Event); } message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent); }
    fail() { this.onerror?.({} as Event); this.onclose?.({} as CloseEvent); }
  }
  const fakeSocket = new FakeSocket();
  const streamStates: string[] = []; const streamOrders: OrderResult[] = [];
  const streamAdapter = new LiveBinanceAdapter(() => 'LIVE_RUNNING', { credentialsProvider: async () => credentials, fetchImpl: successFetch, webSocketFactory: () => fakeSocket as unknown as WebSocket });
  streamAdapter.onPrivateStreamState(state => streamStates.push(state));
  streamAdapter.onOrderUpdate(value => streamOrders.push(value));
  await streamAdapter.connect(); fakeSocket.open(); await new Promise(resolve => setTimeout(resolve, 20));
  ok(fakeSocket.sent.some(value => value.includes('userDataStream.subscribe.signature') && !value.includes(credentials.apiSecret)), 'private stream authenticates without exposing the API secret');
  fakeSocket.message({ id: 'subscription', status: 200, result: { subscriptionId: 0 } });
  fakeSocket.message({ subscriptionId: 0, event: { e: 'executionReport', s: 'BTCUSDT', i: 77, c: 'CB6-stream', S: 'BUY', X: 'PARTIALLY_FILLED', q: '0.002', z: '0.001', Z: '50', E: 123 } });
  ok(streamAdapter.getPrivateStreamState() === 'CONNECTED' && streamOrders[0]?.status === 'partially_filled', 'private execution stream emits canonical partial-fill updates');
  fakeSocket.fail();
  ok(streamStates.includes('DEGRADED') && streamStates.includes('RECONNECTING'), 'private stream disconnect enters degraded/reconnecting state');
  await streamAdapter.disconnect();

  console.log(`\nbinance-live-adapter: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

void main();
