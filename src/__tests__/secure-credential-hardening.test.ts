import { ApiCredentialsStore } from '../core/persistence/ApiCredentialsStore';
import type { SecureCredentialBackend } from '../core/persistence/SecureCredentialStore';
import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { createDefaultAppSettings } from '../core/types';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { LiveBinanceAdapter } from '../core/exchange/LiveBinanceAdapter';
import { logger } from '../utils/logger';
import { sanitizeCredentialArtifact, sanitizeCredentialArtifactJson } from '../core/security/credentialRedaction';
import { JsonExporter } from '../core/persistence/JsonExporter';
import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
function check(value: unknown, name: string): void {
  if (value) { passed++; console.log(`PASS ${passed}: ${name}`); }
  else { failed++; console.error(`FAIL: ${name}`); }
}
async function rejects(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try { await fn(); return false; } catch (error) { return (error instanceof Error ? error.message : String(error)).includes(code); }
}

class TestPersistence extends SettingsPersistence {
  legacy = false;
  clearSucceeds = true;
  settings = createDefaultAppSettings();
  override async hasLegacyPlaintextApiCredentials() { return this.legacy; }
  override async clearApiConfig() { if (this.clearSucceeds) this.legacy = false; }
  override async loadSettings() { return this.settings; }
  override async saveSettings(settings: ReturnType<typeof createDefaultAppSettings>) { this.settings = settings; }
}

function backendHarness() {
  let value: { apiKey: string; apiSecret: string } | null = null;
  let unavailable = false;
  let writeFailure = false;
  let readFailure = false;
  let deleteFailure = false;
  let deletes = 0;
  let signs = 0;
  const backend: SecureCredentialBackend = {
    async save(apiKey, apiSecret) {
      if (unavailable || writeFailure) throw new Error(writeFailure ? 'SECURE_STORE_WRITE_FAILED' : 'SECURE_STORE_UNAVAILABLE');
      value = { apiKey, apiSecret };
      return this.status();
    },
    async status() {
      if (unavailable) throw new Error('SECURE_STORE_UNAVAILABLE');
      if (readFailure) throw new Error('SECURE_STORE_READ_FAILED');
      return { configured: !!value, storageSecure: true, provider: 'test_os_keyring', platform: 'test', maskedApiKey: value ? `****${value.apiKey.slice(-4)}` : null };
    },
    async delete() { if (deleteFailure) throw new Error('SECURE_STORE_DELETE_FAILED'); deletes++; value = null; },
    async sign(payload, includeApiKey) {
      signs++;
      if (readFailure) throw new Error('SECURE_STORE_READ_FAILED');
      if (!value) throw new Error('CREDENTIALS_NOT_CONFIGURED');
      return { apiKey: value.apiKey, signature: `signed:${includeApiKey ? 'key+' : ''}${payload.length}` };
    },
  };
  return {
    backend,
    setUnavailable: (next: boolean) => { unavailable = next; },
    setWriteFailure: (next: boolean) => { writeFailure = next; },
    setReadFailure: (next: boolean) => { readFailure = next; },
    setDeleteFailure: (next: boolean) => { deleteFailure = next; },
    getValue: () => value,
    getDeletes: () => deletes,
    getSigns: () => signs,
  };
}

const secureStatus = async () => ({ configured: true, storageSecure: true, legacyCredentialDetected: false, providerHealthy: true });
function mockFetch(methods: string[]) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); methods.push(String(init?.method ?? 'GET'));
    if (url.includes('/api/v3/time')) return new Response(JSON.stringify({ serverTime: Date.now() }), { status: 200 });
    if (url.includes('/api/v3/account')) return new Response(JSON.stringify({ canTrade: true, accountType: 'SPOT', permissions: ['SPOT'], balances: [{ asset: 'USDT', free: '10', locked: '0' }] }), { status: 200 });
    return new Response(JSON.stringify({ code: -2013, msg: 'Order does not exist.' }), { status: 400 });
  };
}

class MockSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  closed = false;
  sent: string[] = [];
  constructor() { setTimeout(() => this.onopen?.({} as Event), 0); }
  send(data: string) { this.sent.push(data); setTimeout(() => this.onmessage?.({ data: JSON.stringify({ status: 200, result: { subscriptionId: 1 } }) } as MessageEvent), 0); }
  close() { if (this.closed) return; this.closed = true; setTimeout(() => this.onclose?.({} as CloseEvent), 0); }
  emit(data: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

async function run(): Promise<void> {
  const h = backendHarness();
  const persistence = new TestPersistence();
  const store = new ApiCredentialsStore(h.backend, persistence);

  check((await store.loadStatus()).state === 'NOT_CONFIGURED', '1 no credentials configured');
  const saved = await store.save('test-api-key-ABCD', 'secret-one');
  check(saved.state === 'SECURE' && saved.maskedApiKey === '****ABCD', '2 secure save succeeds and masks key');
  const signed = await store.signPayload('symbol=BTCUSDT');
  check(signed.signature.startsWith('signed:') && h.getSigns() === 1, '3 secure credential use signs without secret read API');
  await store.save('replacement-key-WXYZ', 'secret-two');
  check(h.getValue()?.apiSecret === 'secret-two', '4 credential replacement overwrites secure entry');
  await store.clear();
  check(!h.getValue() && (await store.loadStatus()).state === 'NOT_CONFIGURED', '5 credential deletion removes secure entry');

  h.setUnavailable(true);
  check((await store.loadStatus()).state === 'SECURE_STORE_UNAVAILABLE', '6 unavailable secure store reports fail-closed state');
  h.setUnavailable(false); h.setWriteFailure(true);
  check(await rejects(() => store.save('key', 'secret'), 'SECURE_STORE_WRITE_FAILED'), '7 secure-store write failure is normalized');
  h.setWriteFailure(false); await store.save('test-key-ABCD', 'secret'); h.setReadFailure(true);
  check((await store.loadStatus()).state === 'ERROR', '8 secure-store read failure reports ERROR');
  h.setReadFailure(false);

  persistence.legacy = true;
  check((await store.loadStatus()).state === 'MIGRATION_REQUIRED', '9 legacy plaintext credential is detected and blocks secure status');
  await store.save('migrated-key-1234', 'migrated-secret');
  check(!persistence.legacy && (await store.loadStatus()).state === 'SECURE', '10 explicit legacy-to-secure migration succeeds');
  persistence.legacy = true; h.setWriteFailure(true);
  check(await rejects(() => store.save('key', 'secret'), 'SECURE_STORE_WRITE_FAILED') && persistence.legacy, '11 failed secure write preserves legacy copy and fails closed');
  h.setWriteFailure(false); persistence.clearSucceeds = false;
  check(await rejects(() => store.save('key', 'secret'), 'SECURE_STORE_DELETE_FAILED') && !h.getValue(), '12 legacy-delete failure rolls back secure copy');
  persistence.clearSucceeds = true; persistence.legacy = false;

  h.setUnavailable(true);
  check(await rejects(() => store.assertLiveCredentialInvariant(), 'LIVE_CREDENTIAL_STORAGE_NOT_SECURE'), '13 LIVE blocked when storage is unavailable');
  h.setUnavailable(false); await store.save('live-key-ABCD', 'live-secret');
  check((await store.assertLiveCredentialInvariant()).configured, '14 LIVE invariant passes only with secure healthy credentials');

  const paper = new PaperExchangeAdapter();
  await paper.connect();
  check(paper.name === 'Paper', '15 Paper remains operational without secure-store dependency');
  const scannerSource = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  check(!scannerSource.includes('ApiCredentialsStore') && !scannerSource.includes('SecureCredentialStore'), '16 scanner has no secure-store dependency');

  const methods: string[] = [];
  const readOnlyAdapter = new LiveBinanceAdapter(() => 'LIVE_READY', {
    credentialsProvider: async () => ({ apiKey: 'mock-key', apiSecret: 'mock-secret' }),
    credentialSecurityProvider: secureStatus,
    fetchImpl: mockFetch(methods), startPrivateStream: false,
  });
  const readiness = await readOnlyAdapter.runReadinessProbe();
  check(readiness.account.accountReadable && methods.every(method => method === 'GET'), '17 Test API/readiness uses signed read-only requests');
  check(!methods.includes('POST') && !methods.includes('DELETE'), '18 Live Check places and cancels zero orders');

  logger.clear();
  logger.info('audit apiSecret=super-secret apiKey=full-api-key-ABCD signature=deadbeef', { headers: { 'X-MBX-APIKEY': 'full-api-key-ABCD' }, apiSecret: 'super-secret' });
  const logArtifact = logger.export();
  check(!logArtifact.includes('super-secret'), '19 API secret is absent from logs');
  check(!logArtifact.includes('full-api-key-ABCD') && !logArtifact.includes('deadbeef'), '20 full API key and signature are absent from logs');

  const hostileJson = JSON.stringify({ apiSecret: 'journal-secret', apiKey: 'journal-full-key', signature: 'sig', rows: [] });
  const exporter = new JsonExporter({ exportJson: async () => hostileJson, exportMLData: async () => hostileJson, exportTrainingRows: async () => hostileJson, exportAdvisoryRows: async () => hostileJson, exportExcludedRows: async () => hostileJson } as never);
  check(!(await exporter.exportTrades()).json.includes('journal-secret'), '21 secret is absent from Journal export');
  check(!(await exporter.exportML()).json.includes('journal-full-key'), '22 full key is absent from ML export');
  const safeArtifact = JSON.stringify(sanitizeCredentialArtifact({ settings: { apiSecret: 'debug-secret', apiKey: 'debug-full-key' } }));
  check(!safeArtifact.includes('debug-secret') && !safeArtifact.includes('debug-full-key'), '23 settings/debug export removes credential material');
  check(!sanitizeCredentialArtifactJson(hostileJson).includes('journal-secret'), '24 centralized artifact sanitizer removes secrets');
  h.setWriteFailure(true);
  check(await rejects(() => store.save('visible-key', 'visible-secret'), 'SECURE_STORE_WRITE_FAILED'), '25 thrown errors are normalized and contain no credentials');
  h.setWriteFailure(false);
  check(await rejects(() => store.clear({ hasOpenLiveExposure: true }), 'CREDENTIAL_DELETE_BLOCKED_ACTIVE_LIVE_EXPOSURE'), '26 deletion is blocked with active LIVE exposure');

  const sockets: MockSocket[] = [];
  const lifecycle: { listener?: (event: 'saved' | 'replaced' | 'deleted') => void } = {};
  const streamMethods: string[] = [];
  const streamAdapter = new LiveBinanceAdapter(() => 'LIVE_READY', {
    signingProvider: { signPayload: async () => ({ apiKey: 'mock-key', signature: 'mock-signature' }) },
    credentialSecurityProvider: secureStatus,
    credentialLifecycleSubscribe: listener => { lifecycle.listener = listener; return () => { delete lifecycle.listener; }; },
    fetchImpl: mockFetch(streamMethods),
    webSocketFactory: () => { const socket = new MockSocket(); sockets.push(socket); return socket as unknown as WebSocket; },
  });
  await streamAdapter.connect(); await tick();
  lifecycle.listener?.('replaced'); await tick();
  check(sockets.length === 2 && sockets[0].closed, '27 replacement closes old stream before one re-authentication');
  check(sockets.filter(socket => !socket.closed).length === 1, '28 exactly one private stream remains active');
  let orderEvents = 0;
  streamAdapter.onOrderUpdate(() => orderEvents++);
  const executionEvent = { e: 'executionReport', E: 1234, s: 'BTCUSDT', S: 'BUY', i: 99, c: 'cb-test', X: 'FILLED', q: '1', z: '1', Z: '10', T: 1234 };
  sockets[1].emit(executionEvent); sockets[1].emit(executionEvent);
  check(orderEvents === 1, '29 duplicate private order events are suppressed');
  lifecycle.listener?.('deleted'); await tick();
  check(streamAdapter.getPrivateStreamState() === 'DISCONNECTED', '30 credential deletion clears private runtime session');
  await streamAdapter.dispose();

  const liveSource = readFileSync('src/core/exchange/LiveBinanceAdapter.ts', 'utf8');
  check(liveSource.includes('assertCredentialSecurity') && liveSource.includes('submitOrder'), '31 backend/runtime LIVE gate exists beyond UI');
  check(!scannerSource.includes('signPayload') && !scannerSource.includes('loadApiCredentialsStatus'), '32 secureStoreCallsPerScan=0');
  check(!readFileSync('src/core/persistence/ApiCredentialsStore.ts', 'utf8').includes('getCredentialsForTest'), '33 raw secret retrieval API is removed');
  check(!readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8').includes('saveApiConfig('), '34 plaintext credential persistence API is removed');
  check(h.getSigns() < 10, '35 signing/secure-store calls are bounded and not polled');

  console.log(`SECURE CREDENTIAL HARDENING: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

run().catch(error => { console.error(error); process.exit(1); });
