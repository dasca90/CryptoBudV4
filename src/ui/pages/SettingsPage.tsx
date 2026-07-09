import { useState, useEffect, useCallback, useRef } from 'react';
import type { LiveSafetyState, AppSettings, TelegramSettings } from '../../core/types';
import { createDefaultAppSettings, createDefaultTelegramSettings } from '../../core/types';
import { PersistenceBadge } from '../../components/ui/PersistenceBadge';
import { ConfirmDangerAction } from '../../components/ui/ConfirmDangerAction';
import { formatLocalTime } from '../../utils/timeFormatter';
import { SettingsPersistence } from '../../core/persistence/SettingsPersistence';
import { TelegramNotifier } from '../../core/notifications/TelegramNotifier';
import type { Journal } from '../../core/persistence/Journal';
import { logger } from '../../utils/logger';
import { runTauriRuntimeDiagnostics } from '../../core/persistence/TauriRuntimeDiagnostics';
import { apiCredentialsStore } from '../../core/persistence/ApiCredentialsStore';
import { testAppStatePersistenceRoundTrip } from '../../core/persistence/AppStatePersistence';
import { runResetScope } from '../../core/reset/reset-service';
import { normalizePerformanceSettings, savePerformanceSettings } from '../../lib/performance/performanceSettings';
import type { AiProviderName } from '../../core/ai/AiTakeoverTypes';
import {
  clearAiCloudApiSettings,
  createDefaultAiCloudApiSettings,
  getDefaultAiCloudApiUrl,
  loadAiCloudApiSettings,
  maskAiApiKey,
  normalizeAiCloudApiUrl,
  saveAiCloudApiSettings,
  type AiCloudApiSettings,
} from '../../core/ai/AiCloudApiSettings';
import {
  clearAiCloudTestResult,
  createNotTestedAiCloudTestResult,
  loadAiCloudTestResult,
  saveAiCloudTestResult,
  testAiCloudConnectivity,
} from '../../core/ai/AiCloudTestService';
import type { AiCloudTestResult } from '../../core/ai/AiCloudTestTypes';

interface Props {
  liveState: LiveSafetyState;
  onRunLiveCheck: () => void;
  journal?: Journal;
  onExportBackup?: () => void;
  engine?: {
    getPositionManager: () => { clearAllPositions: () => void; getOpenPositions?: () => Array<{ coin: string }> };
    getOrderLockManager: () => { releaseAllLocks: () => void };
    setAnchorSettingsOnBrains: (btc: boolean, eth: boolean) => Promise<void>;
    getAccountBalance: () => number;
    setAccountBalance: (b: number) => void;
    resetPaperPositions: () => Promise<void>;
  };
  publicDataState?: {
    ready: boolean;
    refreshing: boolean;
    exchangeInfoLoaded: boolean;
    lastUpdate: number;
    lastSuccessfulEndpoint?: string | null;
    lastFailureEndpoint?: string | null;
    lastFailureBaseUrl?: string | null;
    lastFailureReason?: string | null;
    lastErrorMessage?: string | null;
    circuitBreakerState?: 'CLOSED' | 'OPEN' | 'HALF_OPEN' | 'RATE_LIMITED';
    retryActive?: boolean;
    nextRetryInMs?: number;
    ticker24hrCacheStatus?: 'fresh' | 'stale' | 'missing';
    bookTickerCacheStatus?: 'fresh' | 'stale' | 'missing';
    scannerUniverseCacheStatus?: 'fresh' | 'stale' | 'missing';
    requestBudgetStatus?: 'OK' | 'EXHAUSTED';
    requestBudgetRemaining?: number;
    requestBudgetMax?: number;
    budgetResetAt?: number;
    budgetExhausted?: boolean;
    budgetExhaustedReason?: string | null;
    requestStormBlocked?: boolean;
  };
  onRefreshPublicData?: () => Promise<boolean>;
}

const settingsPersistence = new SettingsPersistence();
const telegramNotifier = new TelegramNotifier();


export function SettingsPage({ liveState, onRunLiveCheck, journal, onExportBackup, engine, publicDataState, onRefreshPublicData }: Props) {
  const settingsScrollRef = useRef<HTMLDivElement | null>(null);
  const [dbInfo, setDbInfo] = useState(journal?.getDbInfo() ?? null);

  // ── App settings state ─────────────────────────────
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings());
  const [btcAnchor, setBtcAnchor] = useState(true);
  const [ethAnchor, setEthAnchor] = useState(true);

  // ── API config state ───────────────────────────────
  const [apiStatus, setApiStatus] = useState<{
    configured: boolean;
    maskedApiKey: string | null;
    apiSecretConfigured?: boolean;
    storageMode?: 'secure' | 'tauri_app_state' | 'local_fallback';
    error?: string;
  }>({ configured: false, maskedApiKey: null });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiSecretInput, setApiSecretInput] = useState('');
  const [apiUiError, setApiUiError] = useState<string | null>(null);
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [aiCloudSettings, setAiCloudSettings] = useState<AiCloudApiSettings>(createDefaultAiCloudApiSettings());
  const [aiCloudApiKeyInput, setAiCloudApiKeyInput] = useState('');
  const [aiCloudSaved, setAiCloudSaved] = useState(false);
  const [aiCloudTesting, setAiCloudTesting] = useState(false);
  const [aiCloudTestResult, setAiCloudTestResult] = useState<AiCloudTestResult>(() => loadAiCloudTestResult());

  // ── Telegram state ─────────────────────────────────
  const [tgSettings, setTgSettings] = useState<TelegramSettings>(createDefaultTelegramSettings());
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgTestResult, setTgTestResult] = useState<string | null>(null);

  // ── UI state ───────────────────────────────────────
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  // ── Public data state (from global app state, survives tab switches) ──
  const pd = publicDataState ?? {
    ready: false,
    refreshing: false,
    exchangeInfoLoaded: false,
    lastUpdate: 0,
    lastSuccessfulEndpoint: null,
    lastFailureEndpoint: null,
    lastFailureBaseUrl: null,
    lastFailureReason: null,
    lastErrorMessage: null,
    circuitBreakerState: 'CLOSED' as const,
    retryActive: false,
    nextRetryInMs: 0,
    ticker24hrCacheStatus: 'missing' as const,
    bookTickerCacheStatus: 'missing' as const,
    scannerUniverseCacheStatus: 'missing' as const,
    requestBudgetStatus: 'OK' as const,
    requestBudgetRemaining: 0,
    requestBudgetMax: 0,
    budgetResetAt: 0,
    budgetExhausted: false,
    budgetExhaustedReason: null,
    requestStormBlocked: false,
  };
  const publicApiLabel = pd.refreshing
    ? 'LOADING'
    : pd.ready
        ? 'ONLINE'
        : 'OFFLINE';
  const requestBudgetLabel = pd.budgetExhausted || pd.requestBudgetStatus === 'EXHAUSTED' ? 'EXHAUSTED' : 'OK';
  const nextRetrySeconds = Math.ceil((pd.nextRetryInMs ?? 0) / 1000);

  // ── Diagnostics state ──────────────────────────────
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [dbTestResult, setDbTestResult] = useState<string | null>(null);
  const openCountFromPositionManager = engine?.getPositionManager?.().getOpenPositions?.().length ?? dbInfo?.openPositionCount ?? 0;

  useEffect(() => {
    const emitScrollAudit = () => {
      const el = settingsScrollRef.current;
      if (!el) return;
      const style = window.getComputedStyle(el);
      const scrollRangePx = Math.max(0, el.scrollHeight - el.clientHeight);
      logger.info(`SETTINGS_SCROLL_CONTAINER_AUDIT: scrollContainer=settings-layout overflowY=${style.overflowY} heightPx=${Math.round(el.getBoundingClientRect().height)} clientHeight=${el.clientHeight} scrollHeight=${el.scrollHeight} scrollRangePx=${scrollRangePx} canScrollToBottom=${String(scrollRangePx >= 0)} bottomPadding=${style.paddingBottom} bottomClippingProtected=${String(parseFloat(style.paddingBottom || '0') >= 120)} invariantOk=${String(style.overflowY === 'auto' || style.overflowY === 'scroll')} failureReason=${style.overflowY === 'auto' || style.overflowY === 'scroll' ? 'none' : 'SETTINGS_SCROLL_CONTAINER_NOT_SCROLLABLE'}`);
    };
    const raf = window.requestAnimationFrame(emitScrollAudit);
    window.addEventListener('resize', emitScrollAudit);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', emitScrollAudit);
    };
  }, []);

  // ── Diagnostics handler ───────────────────────────
  const handleRunDiagnostics = useCallback(async () => {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const result = await runTauriRuntimeDiagnostics();
      setDiagResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setDiagResult(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDiagLoading(false);
    }
  }, []);

  // ── Load on mount ──────────────────────────────────
  useEffect(() => {
    (async () => {
      const s = await settingsPersistence.loadSettings();
      const performanceSettings = normalizePerformanceSettings(s);
      setSettings({
        ...s,
        graphicsQuality: performanceSettings.graphicsQuality,
        autoPerformanceMode: performanceSettings.autoPerformanceMode === 'on',
      });
      setBtcAnchor(s.btcAnchorEnabled);
      setEthAnchor(s.ethAnchorEnabled);

      const credStatus = await apiCredentialsStore.loadStatus();
      setApiStatus(credStatus);
      const aiCloud = loadAiCloudApiSettings();
      setAiCloudSettings(aiCloud);
      setAiCloudApiKeyInput(aiCloud.apiKey);
      setAiCloudTestResult(loadAiCloudTestResult());

      const tg = await settingsPersistence.loadTelegramSettings();
      setTgSettings(tg);
      setTgBotToken(tg.botToken);
      setTgChatId(tg.chatId);
      telegramNotifier.updateSettings(tg);
    })();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (journal) setDbInfo(journal.getDbInfo());
    }, 5000);
    return () => clearInterval(interval);
  }, [journal]);

  const isLive = liveState === 'LIVE_RUNNING' || liveState === 'LIVE_READY';
  const status = dbInfo?.status ?? 'FALLBACK';

  // ── Handlers ───────────────────────────────────────

  const handleSaveSettings = useCallback(async () => {
    const updated: AppSettings = {
      ...settings,
      btcAnchorEnabled: btcAnchor,
      ethAnchorEnabled: ethAnchor,
      graphicsQuality: normalizePerformanceSettings(settings).graphicsQuality,
      autoPerformanceMode: Boolean(settings.autoPerformanceMode),
      updatedAt: new Date().toISOString(),
    };
    await settingsPersistence.saveSettings(updated);
    savePerformanceSettings({
      graphicsQuality: updated.graphicsQuality,
      autoPerformanceMode: updated.autoPerformanceMode ? 'on' : 'off',
    });
    setSettings(updated);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);

    if (btcAnchor) logger.info('BTC_ANCHOR_ENABLED');
    else logger.info('BTC_ANCHOR_DISABLED');
    if (ethAnchor) logger.info('ETH_ANCHOR_ENABLED');
    else logger.info('ETH_ANCHOR_DISABLED');

    if (engine) {
      await engine.setAnchorSettingsOnBrains(btcAnchor, ethAnchor);
    }
  }, [settings, btcAnchor, ethAnchor, engine]);

  // ── Demo Reset handlers ────────────────────────────

  const handleResetBalance = useCallback(async () => {
    const result = await settingsPersistence.resetDemoBalance();
    if (engine) engine.setAccountBalance(10000);
    setResetResult(`Balance reset at ${result.resetAt}`);
    setTimeout(() => setResetResult(null), 3000);
  }, [engine]);

  const handleResetPositions = useCallback(async () => {
    logger.info('RESET_CONFIRMATION_ACCEPTED: resetScope=reset_trading');
    const result = await runResetScope('reset_trading', { journal, engine: engine as any, settingsPersistence });
    setResetResult(`${result.ok ? 'Trading reset' : 'Reset incomplete'} at ${result.resetAt}`);
    setTimeout(() => setResetResult(null), 3000);
  }, [engine, journal]);

  const handleFullDemoReset = useCallback(async () => {
    logger.info('RESET_CONFIRMATION_ACCEPTED: resetScope=full_demo_reset');
    const result = await runResetScope('full_demo_reset', { journal, engine: engine as any, settingsPersistence });
    setResetResult(`${result.ok ? 'Full demo reset' : 'Reset incomplete'} at ${result.resetAt}`);
    setTimeout(() => setResetResult(null), 3000);
  }, [engine, journal]);

  // ── ML Reset handler ───────────────────────────────

  const handleResetML = useCallback(async () => {
    logger.info('RESET_CONFIRMATION_ACCEPTED: resetScope=reset_ml');
    const result = await runResetScope('reset_ml', { journal, engine: engine as any, settingsPersistence });
    setResetResult(`${result.ok ? 'ML reset' : 'Reset incomplete'} at ${result.resetAt}`);
    setTimeout(() => setResetResult(null), 3000);
  }, [engine, journal]);

  const handleTestDb = useCallback(async () => {
    setDbTestResult('running...');
    const r = await testAppStatePersistenceRoundTrip();
    const pass = r.writeSuccess && r.readSuccess && r.parsedJson && r.tradeInsightSuccess;
    if (pass) setDbTestResult(`PASS (${r.storageEngine})`);
    else {
      const msg = r.errorMessage ?? 'unknown';
      const actionable = msg.includes('save_trade_insight')
        ? `DB test failed: save_trade_insight payload type mismatch on field ${msg}`
        : `DB test failed: ${msg}`;
      setDbTestResult(actionable);
    }
  }, []);

  // ── API handlers ───────────────────────────────────

  const handleSaveApi = useCallback(async () => {
    if (!apiKeyInput || !apiSecretInput) {
      logger.warn('API_CREDENTIALS_SAVE_BLOCKED_MISSING_FIELDS');
      setApiUiError('API key and secret are both required.');
      return;
    }
    setApiUiError(null);
    const result = await apiCredentialsStore.save(apiKeyInput, apiSecretInput);
    setApiStatus(result);
    setApiKeyInput('');
    setApiSecretInput('');
  }, [apiKeyInput, apiSecretInput]);

  const handleClearApi = useCallback(async () => {
    const result = await apiCredentialsStore.clear();
    setApiStatus(result);
    setApiKeyInput('');
    setApiSecretInput('');
    setApiUiError(null);
    setApiTestResult(null);
  }, []);

  const handleTestApi = useCallback(async () => {
    setApiTestResult(null);
    const typed = apiKeyInput && apiSecretInput ? { apiKey: apiKeyInput, apiSecret: apiSecretInput } : null;
    const result = await apiCredentialsStore.testApiCredentials(typed);
    setApiTestResult(result.code);
    const status = await apiCredentialsStore.loadStatus();
    setApiStatus(status);
  }, [apiKeyInput, apiSecretInput]);

  const handleSaveAiCloudApi = useCallback(() => {
    const next: AiCloudApiSettings = {
      ...aiCloudSettings,
      apiKey: aiCloudApiKeyInput,
      apiUrl: normalizeAiCloudApiUrl(aiCloudSettings.apiUrl, aiCloudSettings.provider),
    };
    saveAiCloudApiSettings(next);
    setAiCloudSettings(next);
    const notTested = createNotTestedAiCloudTestResult(next);
    saveAiCloudTestResult(notTested);
    setAiCloudTestResult(notTested);
    setAiCloudSaved(true);
    logger.info(`AI_CLOUD_API_SETTINGS_SAVED: provider=${next.provider} model=${next.model || 'none'} apiUrlConfigured=${String(next.apiUrl.trim().length > 0)} apiKeyConfigured=${String(next.apiKey.trim().length > 0)} storageKey=cryptobud_v5_ai_cloud_api`);
    setTimeout(() => setAiCloudSaved(false), 2000);
  }, [aiCloudSettings, aiCloudApiKeyInput]);

  const handleTestAiCloud = useCallback(async () => {
    const current: AiCloudApiSettings = {
      ...aiCloudSettings,
      apiKey: aiCloudApiKeyInput,
    };
    const testing = {
      ...createNotTestedAiCloudTestResult(current),
      status: 'TESTING' as const,
      lastTestedAt: Date.now(),
    };
    setAiCloudTesting(true);
    setAiCloudTestResult(testing);
    try {
      const result = await testAiCloudConnectivity(current);
      saveAiCloudTestResult(result);
      setAiCloudTestResult(result);
    } finally {
      setAiCloudTesting(false);
    }
  }, [aiCloudSettings, aiCloudApiKeyInput]);

  const handleClearAiCloudApi = useCallback(() => {
    clearAiCloudApiSettings();
    const clearedTest = clearAiCloudTestResult();
    const empty = createDefaultAiCloudApiSettings();
    setAiCloudSettings(empty);
    setAiCloudApiKeyInput('');
    setAiCloudTestResult(clearedTest);
    setAiCloudSaved(false);
    logger.info('AI_CLOUD_API_SETTINGS_CLEARED: storageKey=cryptobud_v5_ai_cloud_api');
  }, []);

  // ── Telegram handlers ──────────────────────────────

  const handleSaveTelegram = useCallback(async () => {
    const updated: TelegramSettings = {
      ...tgSettings,
      botToken: tgBotToken,
      chatId: tgChatId,
    };
    await settingsPersistence.saveTelegramSettings(updated);
    setTgSettings(updated);
    telegramNotifier.updateSettings(updated);
    const appUpdated: AppSettings = {
      ...settings,
      telegramNotificationsEnabled: updated.enabled,
      telegramBotTokenConfigured: updated.botToken.trim().length > 0,
      telegramChatIdConfigured: updated.chatId.trim().length > 0,
      graphicsQuality: normalizePerformanceSettings(settings).graphicsQuality,
      autoPerformanceMode: Boolean(settings.autoPerformanceMode),
      updatedAt: new Date().toISOString(),
    };
    await settingsPersistence.saveSettings(appUpdated);
    setSettings(appUpdated);
  }, [tgSettings, tgBotToken, tgChatId, settings]);

  const handleTestTelegram = useCallback(async () => {
    setTgTestResult('sending...');
    const ok = await telegramNotifier.sendTest();
    setTgTestResult(ok ? 'sent' : 'failed');
    setTimeout(() => setTgTestResult(null), 3000);
  }, []);

  const handleSaveAllSettings = useCallback(async () => {
    const appUpdated: AppSettings = {
      ...settings,
      btcAnchorEnabled: btcAnchor,
      ethAnchorEnabled: ethAnchor,
      telegramNotificationsEnabled: tgSettings.enabled,
      telegramBotTokenConfigured: tgBotToken.trim().length > 0,
      telegramChatIdConfigured: tgChatId.trim().length > 0,
      graphicsQuality: normalizePerformanceSettings(settings).graphicsQuality,
      autoPerformanceMode: Boolean(settings.autoPerformanceMode),
      updatedAt: new Date().toISOString(),
    };
    const tgUpdated: TelegramSettings = {
      ...tgSettings,
      botToken: tgBotToken,
      chatId: tgChatId,
    };

    await settingsPersistence.saveSettings(appUpdated);
    await settingsPersistence.saveTelegramSettings(tgUpdated);
    savePerformanceSettings({
      graphicsQuality: appUpdated.graphicsQuality,
      autoPerformanceMode: appUpdated.autoPerformanceMode ? 'on' : 'off',
    });
    setSettings(appUpdated);
    setTgSettings(tgUpdated);
    telegramNotifier.updateSettings(tgUpdated);

    if (engine) {
      await engine.setAnchorSettingsOnBrains(btcAnchor, ethAnchor);
    }

    logger.info('SETTINGS_SAVED');
    logger.info('TELEGRAM_SETTINGS_SAVED');
    if (btcAnchor) logger.info('BTC_ANCHOR_ENABLED');
    else logger.info('BTC_ANCHOR_DISABLED');
    if (ethAnchor) logger.info('ETH_ANCHOR_ENABLED');
    else logger.info('ETH_ANCHOR_DISABLED');

    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }, [settings, btcAnchor, ethAnchor, tgSettings, tgBotToken, tgChatId, engine]);

  const handleRefreshPublicData = useCallback(async () => {
    if (onRefreshPublicData) await onRefreshPublicData();
  }, [onRefreshPublicData]);

  return (
    <div className="settings-layout" ref={settingsScrollRef} data-testid="settings-scroll-container">
      <div className="page-panel" style={{ maxWidth: 640 }}>
        {/* ── Section: Persistence ─────────────────────── */}
        <div className="panel-section-title">Persistence Status</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <PersistenceBadge status={status} />
          <span style={{ fontSize: 11, color: '#8b949e' }}>
            Trade History: {dbInfo?.tradeCount ?? 0} · Open Positions: {openCountFromPositionManager}
          </span>
        </div>
        {dbInfo && (
          <div style={{ fontSize: 10, color: '#484f58', marginBottom: 12 }}>
            {dbInfo.lastSaveTime && <div>Last Save: {formatLocalTime(dbInfo.lastSaveTime, { format: 'time' })}</div>}
            {dbInfo.lastLoadTime && <div>Last Load: {formatLocalTime(dbInfo.lastLoadTime, { format: 'time' })}</div>}
            {dbInfo.saveError && <div style={{ color: '#f85149' }}>Error: {dbInfo.saveError}</div>}
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleRunDiagnostics}
            disabled={diagLoading}
            style={{ fontSize: 11 }}
          >
            {diagLoading ? 'Running...' : 'Run DB Diagnostics'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleTestDb}
            style={{ fontSize: 11, marginLeft: 8 }}
          >
            Test DB
          </button>
          {dbTestResult && (
            <div style={{ fontSize: 10, marginTop: 6, color: dbTestResult.startsWith('PASS') ? '#3fb950' : '#f85149' }}>
              {dbTestResult}
            </div>
          )}
          {diagResult && (
            <pre style={{ fontSize: 10, marginTop: 6, maxHeight: 200, overflow: 'auto', background: '#0d1117', padding: 8, borderRadius: 4, border: '1px solid #30363d' }}>
              {diagResult}
            </pre>
          )}
        </div>

        {/* ── Section A: Trading Anchors ──────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Trading Anchors</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          When ON, BTC/ETH market context can block or reduce confidence for alt trades.
        </div>

        <div className="settings-row">
          <label className="settings-label">BTC Anchor</label>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={btcAnchor} onChange={e => setBtcAnchor(e.target.checked)} />
            <span style={{ fontSize: 12 }}>{btcAnchor ? 'ON' : 'OFF'}</span>
          </label>
        </div>

        <div className="settings-row">
          <label className="settings-label">ETH Anchor</label>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={ethAnchor} onChange={e => setEthAnchor(e.target.checked)} />
            <span style={{ fontSize: 12 }}>{ethAnchor ? 'ON' : 'OFF'}</span>
          </label>
        </div>

        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveSettings}>
            Save Anchor Settings
          </button>
          {settingsSaved && <span style={{ fontSize: 11, color: '#3fb950' }}>Saved</span>}
        </div>

        {/* ── Section B: Demo Reset ────────────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Demo Trading Reset</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Reset demo trading. Settings and API config are preserved.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Reset Balance Only</div>
            <ConfirmDangerAction
              confirmText="RESET DEMO"
              buttonLabel="Reset Balance"
              onConfirm={handleResetBalance}
              warning="This resets demo balance to starting amount."
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Reset Positions Only</div>
            <ConfirmDangerAction
              confirmText="RESET DEMO"
              buttonLabel="Reset Positions"
              onConfirm={handleResetPositions}
              warning="Reset Trading will clear open positions, closed positions, pending orders, and demo/paper trading history. Settings and banned coins will be kept."
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Full Demo Reset</div>
            <ConfirmDangerAction
              confirmText="RESET DEMO"
              buttonLabel="Full Reset"
              onConfirm={handleFullDemoReset}
              warning="Full Demo Reset will clear demo balances, open positions, closed trades, orders, demo exchange state, and demo journal/trade history. Settings and banned coins will be kept."
            />
          </div>
        </div>

        {/* ── Section C: ML Brain Reset ───────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>ML Brain Reset</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Resets ML predictions, weights, and memory. Journal trades are preserved.
        </div>
        <ConfirmDangerAction
          confirmText="RESET ML"
          buttonLabel="Reset ML Brain"
          onConfirm={handleResetML}
          warning="Reset ML will clear ML training data, labels, feature snapshots, and ML model/cache data. Trading positions and settings will be kept."
        />

        {/* ── Section D: Binance Public Data ───────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Binance Public Data</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Public market scanner does not require API keys.
        </div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          API keys are only required for future live/private account checks.
        </div>
        <div style={{ fontSize: 11, color: pd.ready ? '#3fb950' : pd.refreshing ? '#d29922' : '#f85149', marginBottom: 4 }}>
          Public API connectivity: {publicApiLabel}
        </div>
        <div style={{ fontSize: 11, color: requestBudgetLabel === 'EXHAUSTED' ? '#d29922' : '#3fb950', marginBottom: 4 }}>
          Request budget: {requestBudgetLabel} ({pd.requestBudgetRemaining ?? 0}/{pd.requestBudgetMax ?? 0})
        </div>
        <div style={{ fontSize: 11, color: pd.circuitBreakerState === 'OPEN' ? '#f85149' : pd.circuitBreakerState === 'HALF_OPEN' || pd.circuitBreakerState === 'RATE_LIMITED' ? '#d29922' : '#3fb950', marginBottom: 4 }}>
          Circuit breaker: {pd.circuitBreakerState ?? 'CLOSED'}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
          exchangeInfo loaded: {pd.exchangeInfoLoaded ? 'yes' : 'no'}
        </div>
        <div style={{ fontSize: 11, color: pd.ticker24hrCacheStatus === 'fresh' ? '#3fb950' : pd.ticker24hrCacheStatus === 'stale' ? '#d29922' : '#f85149', marginBottom: 4 }}>
          ticker24hr cache: {(pd.ticker24hrCacheStatus ?? 'missing').toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: pd.bookTickerCacheStatus === 'fresh' ? '#3fb950' : pd.bookTickerCacheStatus === 'stale' ? '#d29922' : '#f85149', marginBottom: 4 }}>
          bookTicker cache: {(pd.bookTickerCacheStatus ?? 'missing').toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: pd.scannerUniverseCacheStatus === 'fresh' ? '#3fb950' : pd.scannerUniverseCacheStatus === 'stale' ? '#d29922' : '#f85149', marginBottom: 4 }}>
          scanner universe: {(pd.scannerUniverseCacheStatus ?? 'missing').toUpperCase()}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>
          last market data update: {pd.lastUpdate ? formatLocalTime(pd.lastUpdate, { format: 'time' }) : 'n/a'}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
          last successful endpoint: {pd.lastSuccessfulEndpoint ?? 'n/a'}
        </div>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
          next retry in: {nextRetrySeconds}s / retry active: {pd.retryActive ? 'yes' : 'no'}
        </div>
        <div style={{ fontSize: 11, color: pd.requestStormBlocked ? '#d29922' : '#8b949e', marginBottom: 4 }}>
          request storm blocked: {pd.requestStormBlocked ? 'yes' : 'no'}
        </div>
        {requestBudgetLabel === 'EXHAUSTED' && (
          <div style={{ fontSize: 11, color: '#d29922', marginBottom: 8 }}>
            budget: {pd.budgetExhaustedReason ?? 'REQUEST_BUDGET_EXCEEDED'} / reset: {pd.budgetResetAt ? formatLocalTime(pd.budgetResetAt, { format: 'time' }) : 'n/a'}
          </div>
        )}
        {!pd.ready && requestBudgetLabel !== 'EXHAUSTED' && (
          <div style={{ fontSize: 11, color: '#f85149', marginBottom: 8 }}>
            failure: {pd.lastFailureEndpoint ?? 'n/a'} / {pd.lastFailureBaseUrl ?? 'n/a'} / {pd.lastFailureReason ?? pd.lastErrorMessage ?? 'n/a'}
          </div>
        )}
        <button className="btn btn-sm btn-yellow" onClick={handleRefreshPublicData}>Refresh Public Data</button>

        <div className="panel-section-title" style={{ marginTop: 20 }}>Performance</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Visual performance only. Trading decisions, scanner ranking, exits, TP/SL, and reports are unchanged.
        </div>
        <div className="settings-row">
          <label className="settings-label">Graphics Quality</label>
          <select
            className="settings-input"
            value={settings.graphicsQuality}
            onChange={(event) => setSettings((s) => ({ ...s, graphicsQuality: event.target.value as AppSettings['graphicsQuality'] }))}
          >
            <option value="low">Low - best for weak PC</option>
            <option value="balanced">Balanced - recommended</option>
            <option value="high">High - full visuals</option>
          </select>
        </div>
        <div className="settings-row">
          <label className="settings-label">Auto Performance Mode</label>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={settings.autoPerformanceMode}
              onChange={(event) => setSettings((s) => ({ ...s, autoPerformanceMode: event.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>{settings.autoPerformanceMode ? 'ON' : 'OFF'}</span>
          </label>
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveSettings}>
            Save Performance Settings
          </button>
          <span style={{ fontSize: 11, color: '#8b949e' }}>Auto mode only downgrades visuals after sustained low FPS.</span>
        </div>

        {/* ── Time-Based Exit ─────────────────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Time-Based Exit</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Automatically close positions after a maximum holding period.
        </div>
        <div className="settings-row">
          <label className="settings-label">Time-Based Exit</label>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={settings.timeBasedExitEnabled}
              onChange={(event) => setSettings((s) => ({ ...s, timeBasedExitEnabled: event.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>{settings.timeBasedExitEnabled ? 'ON' : 'OFF'}</span>
          </label>
        </div>
        {settings.timeBasedExitEnabled && (
          <>
            <div className="settings-row">
              <label className="settings-label">Max Hold Hours</label>
              <select
                className="settings-input"
                value={settings.defaultMaxHoldHours}
                onChange={(event) => setSettings((s) => ({ ...s, defaultMaxHoldHours: Number(event.target.value) }))}
              >
                <option value={12}>12 hours</option>
                <option value={24}>24 hours</option>
                <option value={48}>48 hours (recommended)</option>
                <option value={72}>72 hours</option>
                <option value={96}>96 hours</option>
                <option value={168}>7 days</option>
              </select>
            </div>
            <div className="settings-row">
              <label className="settings-label">Max Exits Per Cycle</label>
              <select
                className="settings-input"
                value={settings.maxTimeBasedExitsPerCycle}
                onChange={(event) => setSettings((s) => ({ ...s, maxTimeBasedExitsPerCycle: Number(event.target.value) }))}
              >
                <option value={1}>1 (most conservative)</option>
                <option value={2}>2 (recommended)</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            </div>
          </>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveSettings}>
            Save Time-Based Exit Settings
          </button>
          {settingsSaved && <span style={{ fontSize: 11, color: '#3fb950' }}>Saved</span>}
        </div>

        <div className="panel-section-title" style={{ marginTop: 20 }}>AI Cloud API</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          V5 AI provider settings for AI Takeover missions. This does not change Binance execution mode.
        </div>
        <div style={{ fontSize: 11, color: aiCloudSettings.apiKey ? '#3fb950' : '#8b949e', marginBottom: 8 }}>
          Status: {aiCloudSettings.provider !== 'OFF' && aiCloudSettings.apiKey ? `Configured (${maskAiApiKey(aiCloudSettings.apiKey)})` : 'Not Configured'}
        </div>

        <div className="settings-row">
          <label className="settings-label">AI Provider</label>
          <select
            className="settings-input"
            value={aiCloudSettings.provider}
            onChange={(event) => {
              const provider = event.target.value as AiProviderName;
              setAiCloudSettings((s) => ({
                ...s,
                provider,
                apiUrl: normalizeAiCloudApiUrl(s.apiUrl || getDefaultAiCloudApiUrl(provider), provider),
              }));
            }}
          >
            <option value="OFF">OFF</option>
            <option value="OpenCode">OpenCode Zen</option>
            <option value="OpenCode Go">OpenCode Go</option>
            <option value="OpenAI">OpenAI</option>
            <option value="DeepSeek">DeepSeek</option>
            <option value="Ollama Local">Ollama Local</option>
          </select>
        </div>

        <div className="settings-row">
          <label className="settings-label">AI Model</label>
          <input
            className="settings-input"
            type="text"
            value={aiCloudSettings.model}
            onChange={(event) => setAiCloudSettings((s) => ({ ...s, model: event.target.value }))}
            placeholder="e.g. opencode model / gpt-4o-mini / deepseek-chat"
          />
        </div>

        <div className="settings-row">
          <label className="settings-label">API URL</label>
          <input
            className="settings-input"
            type="text"
            value={aiCloudSettings.apiUrl}
            onChange={(event) => setAiCloudSettings((s) => ({ ...s, apiUrl: event.target.value }))}
            placeholder="https://.../v1/chat/completions"
          />
        </div>

        <div className="settings-row">
          <label className="settings-label">API Key</label>
          <input
            className="settings-input"
            type="password"
            value={aiCloudApiKeyInput}
            onChange={(event) => setAiCloudApiKeyInput(event.target.value)}
            placeholder={aiCloudSettings.apiKey ? 'saved AI API key' : 'Enter AI cloud API key'}
          />
        </div>

        <div className="ai-cloud-test-panel">
          <div className="ai-cloud-test-line">
            <span>AI Cloud Test</span>
            <span className={`ai-cloud-test-badge ai-cloud-test-badge--${aiCloudTestResult.status.toLowerCase()}`}>
              {aiCloudTesting ? 'TESTING...' : aiCloudTestResult.status.replace('_', ' ')}
            </span>
          </div>
          <div className="ai-cloud-test-grid">
            <span>Provider</span>
            <strong>{aiCloudTestResult.provider}</strong>
            <span>Model</span>
            <strong>{aiCloudTestResult.model || 'n/a'}</strong>
            <span>Endpoint</span>
            <strong>{aiCloudTestResult.endpointDisplay}</strong>
            <span>Last tested</span>
            <strong>{aiCloudTestResult.lastTestedAt ? formatLocalTime(aiCloudTestResult.lastTestedAt, { format: 'datetime' }) : 'n/a'}</strong>
            <span>Latency</span>
            <strong>{aiCloudTestResult.latencyMs === null ? 'n/a' : `${aiCloudTestResult.latencyMs}ms`}</strong>
            <span>Response parsed</span>
            <strong>{aiCloudTestResult.responseParsed ? 'OK' : 'n/a'}</strong>
          </div>
          {aiCloudTestResult.status === 'FAILED' && (
            <div className="ai-cloud-test-error">
              Reason: {aiCloudTestResult.failureReason ?? aiCloudTestResult.errorMessage ?? 'AI_TEST_FAILED'}
            </div>
          )}
          {aiCloudTestResult.status === 'SUCCESS' && (
            <div className="ai-cloud-test-success">Result: OK</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveAiCloudApi}>Save AI Cloud API</button>
          <button
            className="btn btn-sm btn-cyan"
            onClick={handleTestAiCloud}
            disabled={aiCloudTesting || aiCloudSettings.provider === 'OFF'}
            type="button"
          >
            {aiCloudTesting ? 'Testing...' : 'Test AI Cloud'}
          </button>
          <ConfirmDangerAction
            confirmText="CLEAR AI API"
            buttonLabel="Clear AI API"
            onConfirm={handleClearAiCloudApi}
            warning="Remove stored V5 AI cloud provider settings and API key."
          />
          {aiCloudSaved && <span style={{ fontSize: 11, color: '#3fb950', alignSelf: 'center' }}>Saved</span>}
        </div>
        <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>
          Development storage: key is saved locally under V5 AI storage. Use backend/Tauri secure storage before real live deployment.
        </div>

        {/* ── Section E: Binance Private API ───────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Binance API (Private)</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Private API is live-only scope. Live trading remains locked.
        </div>

        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: apiStatus.configured ? '#3fb950' : '#8b949e' }}>
            Status: {apiStatus.configured ? 'Configured' : 'Not Configured'}
          </span>
        </div>

        <div className="settings-row">
          <label className="settings-label">API Key</label>
          <input
            className="settings-input"
            type="password"
            value={apiKeyInput}
            onChange={e => setApiKeyInput(e.target.value)}
            placeholder={apiStatus.configured ? '••••••••••••' : 'Enter API key'}
          />
          {apiStatus.maskedApiKey && !apiKeyInput && (
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 2 }}>Saved: {apiStatus.maskedApiKey}</div>
          )}
        </div>

        <div className="settings-row">
          <label className="settings-label">API Secret</label>
          <input
            className="settings-input"
            type="password"
            value={apiSecretInput}
            onChange={e => setApiSecretInput(e.target.value)}
            placeholder={apiStatus.configured ? '••••••••••••' : 'Enter API secret'}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveApi}>Save API Keys</button>
          <button className="btn btn-sm btn-yellow" onClick={handleTestApi}>Test Connection</button>
          <ConfirmDangerAction
            confirmText="CLEAR API"
            buttonLabel="Clear API Keys"
            onConfirm={handleClearApi}
            warning="Remove stored API keys."
          />
        </div>
        {apiUiError && <div style={{ fontSize: 11, color: '#f85149', marginTop: 6 }}>{apiUiError}</div>}
        {apiStatus.configured && (
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
            API Secret: saved
          </div>
        )}
        {apiStatus.storageMode && apiStatus.storageMode !== 'secure' && (
          <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>
            API keys saved in app storage for development. Secure storage required before live trading.
          </div>
        )}
        {apiTestResult && (
          <div style={{ fontSize: 11, color: apiTestResult === 'API_TEST_SUCCESS' ? '#3fb950' : '#d29922', marginTop: 6 }}>
            {apiTestResult}
          </div>
        )}

        {/* ── Section E: Telegram Notifications ──────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Telegram Notifications</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Receive notifications for trades, errors, and daily summaries.
        </div>

        <div className="settings-row">
          <label className="settings-label">Enable Telegram</label>
          <label className="toggle" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={tgSettings.enabled}
              onChange={e => setTgSettings(s => ({ ...s, enabled: e.target.checked }))}
            />
            <span style={{ fontSize: 12 }}>{tgSettings.enabled ? 'ON' : 'OFF'}</span>
          </label>
        </div>

        <div className="settings-row">
          <label className="settings-label">Bot Token</label>
          <input
            className="settings-input"
            type="password"
            value={tgBotToken}
            onChange={e => setTgBotToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
          />
        </div>

        <div className="settings-row">
          <label className="settings-label">Chat ID</label>
          <input
            className="settings-input"
            type="text"
            value={tgChatId}
            onChange={e => setTgChatId(e.target.value)}
            placeholder="-1001234567890"
          />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 4, marginBottom: 8 }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveTelegram}>Save Telegram</button>
          <button className="btn btn-sm btn-yellow" onClick={handleTestTelegram}>Test Message</button>
          {tgTestResult === 'sending...' && <span style={{ fontSize: 11, color: '#58a6ff' }}>Sending...</span>}
          {tgTestResult === 'sent' && <span style={{ fontSize: 11, color: '#3fb950' }}>Sent</span>}
          {tgTestResult === 'failed' && <span style={{ fontSize: 11, color: '#f85149' }}>Failed</span>}
        </div>

        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Notify on events:</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnBuy} onChange={e => setTgSettings(s => ({ ...s, notifyOnBuy: e.target.checked }))} />
            Buy
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnSell} onChange={e => setTgSettings(s => ({ ...s, notifyOnSell: e.target.checked }))} />
            Sell / SL / TP
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnStopLoss} onChange={e => setTgSettings(s => ({ ...s, notifyOnStopLoss: e.target.checked }))} />
            Stop Loss
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnTakeProfit} onChange={e => setTgSettings(s => ({ ...s, notifyOnTakeProfit: e.target.checked }))} />
            Take Profit
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnBlock} onChange={e => setTgSettings(s => ({ ...s, notifyOnBlock: e.target.checked }))} />
            Blocks
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnError} onChange={e => setTgSettings(s => ({ ...s, notifyOnError: e.target.checked }))} />
            Errors
          </label>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={tgSettings.notifyOnDailySummary} onChange={e => setTgSettings(s => ({ ...s, notifyOnDailySummary: e.target.checked }))} />
            Daily Summary
          </label>
        </div>

        <div style={{ marginTop: 8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveAllSettings}>
            Save Settings
          </button>
          <span style={{ fontSize: 11, color: '#8b949e' }}>Save anchors + Telegram toggles/token/chat ID</span>
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: '#8b949e' }}>
          Demo trading controls moved to Trade page.
        </div>

        {/* ── Backup & Export ─────────────────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Backup & Export</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Export a full backup including trades, app state, and ML dataset.
        </div>
        {onExportBackup && (
          <button className="btn btn-sm btn-green" onClick={onExportBackup}>Export Full Backup</button>
        )}

        {/* ── Live Trading ──────────────────────────────── */}
        <div className="panel-section-title" style={{ marginTop: 20 }}>Live Trading</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          Live trading is disabled by default. Run the safety check to verify your setup.
        </div>
        {isLive ? (
          <div style={{ color: '#d29922', fontSize: 12 }}>⚠ Live mode active. Handle with care.</div>
        ) : (
          <div style={{ color: '#8b949e', fontSize: 12 }}>
            API not configured. Live remains locked until safety check passes.
          </div>
        )}
        <button className="btn btn-sm btn-yellow" style={{ marginTop: 8 }} onClick={onRunLiveCheck}>
          Run Live Check
        </button>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm btn-green" onClick={handleSaveAllSettings}>
            Save Settings
          </button>
          {settingsSaved && <span style={{ fontSize: 11, color: '#3fb950' }}>Saved</span>}
        </div>

        {/* ── Reset feedback ─────────────────────────── */}
        {resetResult && (
          <div style={{ marginTop: 12, fontSize: 11, color: '#3fb950' }}>
            {resetResult}
          </div>
        )}
        <div className="settings-scroll-bottom-sentinel" aria-hidden="true" />
      </div>
    </div>
  );
}


