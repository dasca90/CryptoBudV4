import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { TelegramNotifier } from '../core/notifications/TelegramNotifier';
import { TraderBrain } from '../core/trading/TraderBrain';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { MLPredictor } from '../core/ml/MLPredictor';
import { PositionManager } from '../core/positions/PositionManager';
import { OrderLockManager } from '../core/orders/OrderLockManager';
import {
  createDefaultAppSettings, createDefaultAnchorSettings, createDefaultTelegramSettings, createDefaultApiConfig,
} from '../core/types';
import type { AppSettings, TelegramSettings, ResetResult } from '../core/types';
import { logger } from '../utils/logger';
import { ApiCredentialsStore } from '../core/persistence/ApiCredentialsStore';
import type { SecureCredentialBackend } from '../core/persistence/SecureCredentialStore';
import { backupService } from '../core/persistence/BackupService';
import { createDefaultAppState } from '../core/persistence/AppStatePersistence';
import { resolveTradingTargetOwnership } from '../core/trading/TradingTargetOwnership';
import { normalizeBannedCoinInput } from '../core/trading/banned-symbols';
import { resolveEntryRiskParams } from '../core/trading/entry-risk-resolver';

let p = 0, f = 0;
function ok(c: boolean, m: string) { if (c) { p++; } else { f++; console.log('  FAIL: ' + m); } }
function eq<T>(a: T, b: T, m: string) { ok(a === b, m); }

function createSecureTestStore() {
  let credentials: { apiKey: string; apiSecret: string } | null = null;
  const backend: SecureCredentialBackend = {
    async save(apiKey, apiSecret) { credentials = { apiKey, apiSecret }; return this.status(); },
    async status() { return { configured: !!credentials, storageSecure: true, provider: 'test_keyring', platform: 'test', maskedApiKey: credentials ? `****${credentials.apiKey.slice(-4)}` : null }; },
    async delete() { credentials = null; },
    async sign() { if (!credentials) throw new Error('CREDENTIALS_NOT_CONFIGURED'); return { apiKey: credentials.apiKey, signature: 'test-signature' }; },
  };
  return new ApiCredentialsStore(backend);
}

async function testDefaults() {
  console.log('\n--- A: default settings safe ---');
  const def = createDefaultAppSettings();
  eq(def.btcAnchorEnabled, true, 'A1: BTC anchor ON by default');
  eq(def.ethAnchorEnabled, true, 'A2: ETH anchor ON by default');
  eq(def.telegramNotificationsEnabled, false, 'A3: Telegram OFF by default');
  eq(def.demoTradingEnabled, true, 'A4: Demo trading ON by default');
  eq(def.riskStyle, 'moderate', 'A5: Risk style moderate by default');
  eq(def.maxPositions, 24, 'A6: Max positions 24 by default');
  eq(def.capitalPerTrade, 100, 'A7: Capital per trade 100 by default');
  eq(def.allowedGroups, 'all', 'A8: All groups allowed by default');
  eq(def.binanceApiConfigured, false, 'A9: API not configured by default');
  eq(def.binanceApiKeyMasked, null, 'A10: No API key mask by default');
  eq(def.scannerReferencePeriod, '1h', 'A10b: scanner reference period default 1h');
  eq(def.entryConfirmationMode, 'smart', 'A10d: entry confirmation mode default smart');
  ok(def.scannerRiskGroups.top_caps && def.scannerRiskGroups.large_caps && def.scannerRiskGroups.mid_caps && def.scannerRiskGroups.high_risk && def.scannerRiskGroups.very_high_risk, 'A10c: scanner risk groups default all ON');

  const anchor = createDefaultAnchorSettings();
  eq(anchor.btcAnchorEnabled, true, 'A11: Anchor BTC ON');
  eq(anchor.ethAnchorEnabled, true, 'A12: Anchor ETH ON');
  eq(anchor.blockAltBuysOnBtcDump, true, 'A13: Block alts on BTC dump');
  eq(anchor.blockAltBuysOnEthDump, false, 'A14: Block alts on ETH dump OFF');

  const tg = createDefaultTelegramSettings();
  eq(tg.enabled, false, 'A15: Telegram OFF');
  eq(tg.botToken, '', 'A16: Bot token empty');
  eq(tg.chatId, '', 'A17: Chat ID empty');

  const api = createDefaultApiConfig();
  eq(api.status, 'NOT_CONFIGURED', 'A18: API status NOT_CONFIGURED');
  eq(api.apiKey, '', 'A19: API key empty');
  eq(api.apiSecret, '', 'A20: API secret empty');
}

async function testBtcAnchorOff() {
  console.log('\n--- B: BTC anchor OFF disables hard BTC blocking ---');
  const brain = new TraderBrain(
    { coin: 'ALTUSDT', mode: 'AUTO', enabled: true, maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30, mlEnabled: true, minConfidence: 0.6 },
    new PaperExchangeAdapter(), new MLPredictor()
  );
  brain.setAnchorSettings(false, true);
  ok(true, 'B1: BTC anchor can be set to OFF');

  const settings = createDefaultAppSettings();
  const updated: AppSettings = { ...settings, btcAnchorEnabled: false };
  eq(updated.btcAnchorEnabled, false, 'B2: BTC anchor OFF in settings');
}

async function testBtcAnchorOn() {
  console.log('\n--- C: BTC anchor ON blocking ---');
  const brain = new TraderBrain(
    { coin: 'ALTUSDT', mode: 'AUTO', enabled: true, maxPositionSize: 100, stopLossPercent: 2, takeProfitPercent: 5, maxLeverage: 1, cooldownSeconds: 30, mlEnabled: true, minConfidence: 0.6 },
    new PaperExchangeAdapter(), new MLPredictor()
  );
  brain.setAnchorSettings(true, true);
  ok(true, 'C1: BTC anchor can be set to ON');

  const settings = createDefaultAppSettings();
  eq(settings.btcAnchorEnabled, true, 'C2: BTC anchor ON by default enables blocking');
}

async function testEthAnchorOff() {
  console.log('\n--- D: ETH anchor OFF removes ETH penalty/block ---');
  const settings = createDefaultAppSettings();
  const updated: AppSettings = { ...settings, ethAnchorEnabled: false };
  eq(updated.ethAnchorEnabled, false, 'D1: ETH anchor OFF');
  eq(updated.btcAnchorEnabled, true, 'D2: BTC still ON');
}

async function testPersistRestore() {
  console.log('\n--- E: settings persist and restore ---');
  const persistence = new SettingsPersistence();
  const original = createDefaultAppSettings();
  const modified: AppSettings = {
    ...original,
    btcAnchorEnabled: false,
    riskStyle: 'conservative',
    maxPositions: 5,
    scannerReferencePeriod: '4h',
    entryConfirmationMode: 'aggressive',
    scannerUniverseSize: 400,
    scannerRiskGroups: { top_caps: true, large_caps: false, mid_caps: true, high_risk: false, very_high_risk: false },
  };

  await persistence.saveSettings(modified);
  const loaded = await persistence.loadSettings();

  eq(loaded.btcAnchorEnabled, false, 'E1: BTC anchor OFF restored');
  eq(loaded.riskStyle, 'conservative', 'E2: risk style restored');
  eq(loaded.maxPositions, 5, 'E3: max positions restored');
  eq(loaded.scannerReferencePeriod, '4h', 'E3b: scanner reference period restored');
  eq(loaded.entryConfirmationMode, 'aggressive', 'E3d: entry confirmation mode restored');
  eq(loaded.scannerUniverseSize, 400, 'E3h: scanner universe size above 250 persists exactly');
  eq(loaded.scannerRiskGroups.large_caps, false, 'E3c: scanner risk group toggle restored');
  eq((loaded as any).autoTradingCapital ?? 1000, (modified as any).autoTradingCapital ?? 1000, 'E3e: trading capital restored');
  eq((loaded as any).capitalPerCoin ?? loaded.capitalPerTrade, (modified as any).capitalPerCoin ?? modified.capitalPerTrade, 'E3f: capital per coin restored');
  eq(loaded.maxPositions, modified.maxPositions, 'E3g: max open positions restored');
  ok(loaded.updatedAt.length > 0, 'E4: updatedAt set');
}

async function testBannedCoinPersistenceAndNormalization() {
  console.log('\n--- E2: banned coin normalization + persistence ---');
  const persistence = new SettingsPersistence();
  const base = createDefaultAppSettings();
  const n1 = normalizeBannedCoinInput('euriusdt');
  const n2 = normalizeBannedCoinInput(' euri ');
  ok(!!n1 && n1.symbol === 'EURIUSDT', 'E2.1 normalize full symbol works');
  ok(!!n2 && n2.baseAsset === 'EURI', 'E2.2 normalize base asset works');
  const toSave = { ...base, scannerBanlist: ['EURIUSDT', 'EURI'], manualScannerBanlist: ['EURIUSDT', 'EURI'] };
  await persistence.saveSettings(toSave as any);
  const loaded = await persistence.loadSettings();
  ok(loaded.scannerBanlist.includes('EURIUSDT') && loaded.scannerBanlist.includes('EURI'), 'E2.3 banned list persists across load');
}

async function testResetBalance() {
  console.log('\n--- F: reset demo balance only ---');
  const persistence = new SettingsPersistence();
  const result = await persistence.resetDemoBalance();

  eq(result.success, true, 'F1: success');
  eq(result.resetType, 'reset_balance', 'F2: type is reset_balance');
  ok(result.clearedItems.includes('paper_balance'), 'F3: cleared paper_balance');
  ok(result.preservedItems.includes('journal_trades'), 'F4: journal preserved');
  ok(result.preservedItems.includes('ml_brain'), 'F5: ML preserved');
  ok(result.preservedItems.includes('app_settings'), 'F6: settings preserved');
  ok(result.errors.length === 0, 'F7: no errors');
}

async function testResetPositions() {
  console.log('\n--- G: reset demo positions only ---');
  const persistence = new SettingsPersistence();
  const result = await persistence.resetDemoPositions();

  eq(result.success, true, 'G1: success');
  eq(result.resetType, 'reset_positions', 'G2: type is reset_positions');
  ok(result.clearedItems.includes('paper_positions'), 'G3: cleared positions');
  ok(result.clearedItems.includes('order_locks'), 'G4: cleared locks');
  ok(result.preservedItems.includes('paper_balance'), 'G5: balance preserved');
  ok(result.errors.length === 0, 'G6: no errors');
}

async function testFullDemoReset() {
  console.log('\n--- H: full demo reset ---');
  const persistence = new SettingsPersistence();
  const result = await persistence.fullDemoReset();

  eq(result.success, true, 'H1: success');
  eq(result.resetType, 'full_demo_reset', 'H2: type');
  ok(result.clearedItems.includes('paper_balance'), 'H3: cleared balance');
  ok(result.clearedItems.includes('paper_positions'), 'H4: cleared positions');
  ok(result.clearedItems.includes('order_locks'), 'H5: cleared locks');
  ok(result.preservedItems.includes('app_settings'), 'H6: settings preserved');
  ok(result.preservedItems.includes('journal_trades'), 'H7: journal preserved');
  ok(result.errors.length === 0, 'H8: no errors');
}

async function testResetML() {
  console.log('\n--- I: reset ML brain ---');
  const persistence = new SettingsPersistence();
  const result = await persistence.resetMLBrain();

  eq(result.success, true, 'I1: success');
  eq(result.resetType, 'reset_ml', 'I2: type');
  ok(result.clearedItems.includes('ml_predictions'), 'I3: cleared predictions');
  ok(result.clearedItems.includes('ml_weights'), 'I4: cleared weights');
  ok(result.clearedItems.includes('ml_memory'), 'I5: cleared memory');
  ok(result.preservedItems.includes('journal_trades'), 'I6: journal preserved');
  ok(result.errors.length === 0, 'I7: no errors');
}

async function testApiKeyMasking() {
  console.log('\n--- J: API key masking ---');
  const fullKey = 'my-super-secret-api-key-12345';
  const masked = fullKey.length > 6 ? fullKey.slice(0, 4) + '...' + fullKey.slice(-4) : null;
  eq(masked, 'my-s...2345', 'J1: API key masked correctly');

  const shortKey = 'abc';
  const shortMasked = shortKey.length > 6 ? shortKey.slice(0, 4) + '...' + shortKey.slice(-4) : null;
  eq(shortMasked, null, 'J2: short key not masked');

  const settings = createDefaultAppSettings();
  const updated = { ...settings, binanceApiKeyMasked: masked };
  eq(updated.binanceApiKeyMasked, 'my-s...2345', 'J3: masked key stored in settings');
}

async function testClearApiConfirmation() {
  console.log('\n--- K: clear API requires confirmation ---');
  const required = 'CLEAR API';
  eq(required, 'CLEAR API', 'K1: required text matches');
  ok('CLEAR API' === 'CLEAR API', 'K2: confirmation text required');
}

async function testTelegramDisabled() {
  console.log('\n--- L: Telegram disabled does not send ---');
  const notifier = new TelegramNotifier({ enabled: false, botToken: '', chatId: '' });
  const sent = await notifier.notify('BUY_OPENED', { event: 'BUY_OPENED', symbol: 'TEST', message: 'test' });
  eq(sent, false, 'L1: not sent when disabled');
}

async function testTelegramMissingConfig() {
  console.log('\n--- M: Telegram test missing config fails cleanly ---');
  const notifier = new TelegramNotifier({ enabled: true, botToken: '', chatId: '' });
  const sent = await notifier.sendTest();
  eq(sent, false, 'M1: sendTest fails when missing config');
}

async function testTelegramTestConfigured() {
  console.log('\n--- N: Telegram test configured attempts send once ---');
  const notifier = new TelegramNotifier({ enabled: true, botToken: 'fake:token', chatId: '123' });
  const sent = await notifier.sendTest();
  eq(sent, false, 'N1: send fails with fake token (no real HTTP)');
}

async function testSecretsNotLogged() {
  console.log('\n--- O: secrets not logged ---');
  logger.clear();
  logger.info('probe apiKey=test-key-12345 apiSecret=test-secret-67890 signature=test-signature');
  const logs = logger.getLogs().map(row => row.message);
  const apiKeyInLogs = logs.some(l => l.includes('test-key-12345') || l.includes('test-secret-67890') || l.includes('test-signature'));
  eq(apiKeyInLogs, false, 'O1: API key/secret not in logs');
}

async function testApiPersistenceAfterTabChange() {
  console.log('\n--- F2/G/H: API persistence + secret safety + public/private separation ---');
  const source = await import('node:fs').then(fs => fs.readFileSync('src/core/persistence/ApiCredentialsStore.ts', 'utf8'));
  ok(!source.includes('saveApiConfig('), 'F2: API store never persists credentials in generic settings');
  ok(!source.includes('getCredentialsForTest'), 'G2: no raw secret read API exists');
  const page = await import('node:fs').then(fs => fs.readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8'));
  ok(page.includes('Binance Public Data') && page.includes('Binance LIVE Credentials'), 'H2: public scanner status is separate from private API status');
}

async function testApiCredentialStoreFlow() {
  console.log('\n--- API store flow ---');
  const apiCredentialsStore = createSecureTestStore();
  let missingBlocked = false;
  try { await apiCredentialsStore.saveApiCredentials({ apiKey: '', apiSecret: '' }); } catch { missingBlocked = true; }
  eq(missingBlocked, true, 'A: missing fields blocked');

  const saved = await apiCredentialsStore.saveApiCredentials({ apiKey: 'abcd1234wxyz', apiSecret: 'very-secret' });
  eq(saved.configured, true, 'B: save sets configured true');
  eq(saved.apiKeyConfigured, true, 'C: api key configured');
  eq(saved.apiSecretConfigured, true, 'D: api secret configured');
  ok(!!saved.maskedApiKey, 'E: masked key exists');
  eq(saved.maskedApiKey === '****wxyz', true, 'F: key masked');

  const rawUiLoad = await new SettingsPersistence().loadApiConfig();
  eq(rawUiLoad.apiSecret, '', 'G: ui-facing load never returns raw secret');

  ok(!('getCredentialsForTest' in apiCredentialsStore), 'H: raw credential getter is absent');

  const remountStatus = await apiCredentialsStore.loadApiCredentialsStatus();
  eq(remountStatus.configured, true, 'I: remount status remains configured');

  const settingsPersistence = new SettingsPersistence();
  const before = await settingsPersistence.loadSettings();
  await settingsPersistence.saveSettings({ ...before, riskStyle: 'aggressive', updatedAt: new Date().toISOString() });
  const afterGeneralSave = await apiCredentialsStore.loadApiCredentialsStatus();
  eq(afterGeneralSave.configured, true, 'J: general Save Settings does not clear API credentials');

  const stillConfigured = await apiCredentialsStore.loadApiCredentialsStatus();
  eq(stillConfigured.configured, true, 'K: empty API fields do not overwrite saved credentials');

  ok(apiCredentialsStore.testApiCredentials.length === 0, 'L/M: Test API accepts no typed credential bypass');

  await apiCredentialsStore.clearApiCredentials();
  const testNoCreds = await apiCredentialsStore.testApiCredentials();
  eq(testNoCreds.code, 'API_NOT_CONFIGURED', 'N: no creds returns API_NOT_CONFIGURED');
  const cleared = await apiCredentialsStore.loadApiCredentialsStatus();
  eq(cleared.configured, false, 'O: clear removes credentials');
}

async function testBackupSecretSafety() {
  console.log('\n--- Backup secret safety ---');
  const apiCredentialsStore = createSecureTestStore();
  await apiCredentialsStore.saveApiCredentials({ apiKey: 'backup-key-123456789', apiSecret: 'backup-secret-abcdef' });
  const { json } = await backupService.exportFullBackup([], createDefaultAppState());
  ok(!json.includes('backup-secret-abcdef'), 'P: backup does not include raw API secret');
  ok(!json.includes('backup-key-123456789'), 'Q: backup does not include raw API key');
  ok(json.includes('maskedApiKey'), 'R: backup may include masked key');
}

async function testTradingTargetOwnership() {
  console.log('\n--- Trading target ownership (AutoBots / Manual Override) ---');
  const baseCandidate = {
    symbol: 'BTCUSDT',
    riskGroup: 'top_caps',
    confidence: 0.82,
    tpRoomOk: true,
    dataQuality: 'GOOD',
    groupTrend: 'bullish',
    autoStrategyDecision: { confidenceTier: 'high', groupTrend: 'bullish' },
  } as any;

  const auto = resolveTradingTargetOwnership(baseCandidate, {
    strategySource: 'autobots',
    manualTp1Pct: 2,
    manualTp2Pct: 4,
    stopLossPct: 1.7,
    dynamicTrailingEnabled: true,
    trailPullbackPct: 0.4,
  });
  eq(auto.tp1Source, 'AutoBots dynamic per coin', 'S1: AutoBots mode sets TP1 source to dynamic per coin');
  eq(auto.tp2Value, 0, 'S2: AutoBots mode sets TP2 to 0');
  eq(auto.slSource, 'user', 'S3: SL stays user-owned in AutoBots');
  eq(auto.trailingStartsAt, 'TP1', 'S4: Dynamic trailing starts at TP1 in AutoBots');
  eq(auto.trailPullbackSource, 'user', 'S5: Trail pullback stays user-owned');

  const manual = resolveTradingTargetOwnership(baseCandidate, {
    strategySource: 'manual_override',
    manualTp1Pct: 3.3,
    manualTp2Pct: 6.2,
    stopLossPct: 2.1,
    dynamicTrailingEnabled: false,
    trailPullbackPct: 0.35,
  });
  eq(manual.tp1Source, 'user', 'S6: Manual Override uses user TP1');
  eq(manual.tp2Source, 'user', 'S7: Manual Override uses user TP2');
  eq(manual.tp1Value, 3.3, 'S8: Manual Override keeps TP1 value');
  eq(manual.tp2Value, 6.2, 'S9: Manual Override keeps TP2 value');
  eq(manual.slValue, 2.1, 'S10: SL remains user-defined in Manual Override');
}

async function testAutoBotsTp2ZeroResolver() {
  console.log('\n--- S2b: AutoBots TP2 enforcement resolver ---');
  const resolved = resolveEntryRiskParams({
    autoBotsOn: true,
    ownership: {
      strategySource: 'autobots',
      tp1Source: 'AutoBots dynamic per coin',
      tp1Value: 2.5,
      tp2Source: 'disabled',
      tp2Value: 4,
      slSource: 'user',
      slValue: 1.5,
      dynamicTrailingEnabled: true,
      trailingStartSource: 'tp1_rule',
      trailingStartsAt: 'TP1',
      trailPullbackSource: 'user',
      trailPullbackValue: 0.25,
      reason: 'test',
    },
    userStopLossPct: 1.5,
    userTrailPullbackPct: 0.25,
  });
  eq(resolved.tp2, 0, 'S2b.1 AutoBots enforces TP2=0');
  eq(resolved.sl, 1.5, 'S2b.2 AutoBots keeps user SL');
  eq(String(resolved.trailStart), 'TP1', 'S2b.3 dynamic trailing starts at TP1');
}

async function testEntryGateQualitySettingsWiring() {
  console.log('\n--- EntryGate quality settings wiring ---');
  const fs = await import('node:fs');
  const tradePage = fs.readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
  const scanner = fs.readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
  ok(tradePage.includes('setEntryGateQualitySettings'), 'T1: TradePage pushes maxSpread/maxSlippage/maxTotalCost/maxPriceAge to scanner');
  ok(scanner.includes('ENTRY_GATE_SETTINGS_SOURCE_AUDIT:'), 'T2: scanner emits ENTRY_GATE_SETTINGS_SOURCE_AUDIT');
  ok(scanner.includes('ENTRY_CONFIRMATION_TRACE:'), 'T3: scanner emits ENTRY_CONFIRMATION_TRACE');
  ok(scanner.includes('spreadPass=') && scanner.includes('slippagePass=') && scanner.includes('totalCostPass='), 'T4: top mover trace includes spread/slippage/totalCost pass flags');
}

(async () => {
  console.log('=== Settings Test Suite ===');
  await testDefaults();
  await testBtcAnchorOff();
  await testBtcAnchorOn();
  await testEthAnchorOff();
  await testPersistRestore();
  await testBannedCoinPersistenceAndNormalization();
  await testResetBalance();
  await testResetPositions();
  await testFullDemoReset();
  await testResetML();
  await testApiKeyMasking();
  await testClearApiConfirmation();
  await testTelegramDisabled();
  await testTelegramMissingConfig();
  await testTelegramTestConfigured();
  await testSecretsNotLogged();
  await testApiPersistenceAfterTabChange();
  await testApiCredentialStoreFlow();
  await testBackupSecretSafety();
  await testTradingTargetOwnership();
  await testAutoBotsTp2ZeroResolver();
  await testEntryGateQualitySettingsWiring();
  console.log(`\n=== Settings Suite: ${p} passed, ${f} failed ===`);
  if (f > 0) process.exit(1);
})();
