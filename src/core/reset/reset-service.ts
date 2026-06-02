import type { Journal } from '../persistence/Journal';
import { SettingsPersistence } from '../persistence/SettingsPersistence';
import { resetMLBrain } from '../ml/ml-brain-store';
import { tauriDb } from '../persistence/TauriBridge';
import type { ResetScope, ResetSummary } from './reset-types';
import { logResetAudit } from './reset-audit';

type EngineLike = {
  getPositionManager: () => { clearAllPositions: (force?: boolean) => void; getOpenPositions?: () => Array<{ coin: string }> };
  getOrderLockManager: () => { releaseAllLocks: () => void };
  setAccountBalance: (b: number) => void;
  resetPaperPositions: () => Promise<void>;
};

const FALLBACK_PREFIX = 'cryptobud_v4:';
const RESET_MARKER_KEY = 'reset_meta_v1';

export async function runResetScope(scope: ResetScope, deps: {
  journal?: Journal;
  engine?: EngineLike;
  settingsPersistence: SettingsPersistence;
}): Promise<ResetSummary> {
  const resetAt = new Date().toISOString();
  const preservedStorageKeys = ['app_settings', 'api_config', 'telegram_settings'];
  const affectedStorageKeys: string[] = [];
  logResetAudit('RESET_REQUESTED', scope, { requestedByUser: true, timestamp: resetAt });
  logResetAudit('RESET_SCOPE_RESOLVED', scope, {});

  if (scope === 'reset_trading' || scope === 'full_demo_reset') {
    logResetAudit('RESET_RUNTIME_CLEAR_START', scope, {});
    await deps.engine?.resetPaperPositions();
    deps.engine?.getOrderLockManager().releaseAllLocks();
    deps.engine?.getPositionManager().clearAllPositions(true);
    if (scope === 'full_demo_reset') deps.engine?.setAccountBalance(10000);

    logResetAudit('RESET_PERSISTENCE_CLEAR_START', scope, {});
    logResetAudit('RESET_BACKUP_CLEAR_START', scope, {});
    await deps.journal?.clearTradingPersistence();
    affectedStorageKeys.push('trades', 'open_positions', 'closed_trades_primary', 'closed_trades_critical', 'open_positions_primary', 'open_positions_critical');
  }

  if (scope === 'reset_ml') {
    logResetAudit('ML_RESET_START', scope, {});
    resetMLBrain();
    try { await tauriDb.clearAppStatePrefix('diagnostic_trade_insight_'); } catch { /* fallback */ }
    if (typeof window !== 'undefined' && window.localStorage) {
      Object.keys(window.localStorage)
        .filter(k => k.startsWith(`${FALLBACK_PREFIX}diagnostic_trade_insight_`) || k.endsWith('ml_brain'))
        .forEach(k => window.localStorage.removeItem(k));
    }
    affectedStorageKeys.push('ml_brain', 'diagnostic_trade_insight_*');
    logResetAudit('ML_RESET_COMPLETE', scope, {});
  }

  logResetAudit('RESET_STORAGE_MAP_AUDIT', scope, { affectedStorageKeys, preservedStorageKeys });

  const marker = JSON.stringify({ resetScope: scope, resetAt, resetVersion: 1 });
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`${FALLBACK_PREFIX}${RESET_MARKER_KEY}`, marker);
  }
  try { await tauriDb.saveAppState(RESET_MARKER_KEY, marker); } catch { /* fallback */ }
  logResetAudit('RESET_MARKER_WRITTEN', scope, { resetAt, resetVersion: 1 });

  const settingsAfter = await deps.settingsPersistence.loadSettings();
  const settingsPreserved = !!settingsAfter;
  const bannedCoinsPreserved = Array.isArray(settingsAfter.scannerBanlist);

  logResetAudit('RESET_VERIFY_START', scope, {});
  const remainingOpenCount = deps.engine?.getPositionManager().getOpenPositions?.().length ?? 0;
  const remainingClosedCount = deps.journal?.getClosedTrades().length ?? 0;
  const remainingJournalCount = deps.journal?.getTrades().length ?? 0;
  const remainingMlRecordCount = deps.journal?.computeMLCounts().trainingEligible ?? 0;
  const persistenceCounts = await deps.journal?.getPersistenceCounts?.();
  const totalPersistedTradingRows = (persistenceCounts?.openPrimaryCount ?? 0)
    + (persistenceCounts?.openBackupCount ?? 0)
    + (persistenceCounts?.closedPrimaryCount ?? 0)
    + (persistenceCounts?.closedBackupCount ?? 0)
    + (persistenceCounts?.tauriOpenCount ?? 0)
    + (persistenceCounts?.tauriTradeCount ?? 0);
  const ok = scope === 'reset_ml'
    ? remainingOpenCount >= 0
    : remainingOpenCount === 0 && remainingClosedCount === 0 && totalPersistedTradingRows === 0;
  const failureReason = ok ? 'none' : `storageKey=trading_persistence_bundle remainingRows=${totalPersistedTradingRows}`;
  logResetAudit(ok ? 'RESET_VERIFY_SUCCESS' : 'RESET_VERIFY_FAILED', scope, {
    remainingOpenCount, remainingClosedCount, remainingJournalCount, remainingMlRecordCount, settingsPreserved, bannedCoinsPreserved, totalPersistedTradingRows, failureReason,
  });
  logResetAudit('RESET_COMPLETE', scope, {
    affectedStorageKeys, preservedStorageKeys, settingsPreserved, bannedCoinsPreserved,
  });

  return {
    ok,
    resetScope: scope,
    resetAt,
    affectedStorageKeys,
    preservedStorageKeys,
    remainingOpenCount,
    remainingClosedCount,
    remainingJournalCount,
    remainingMlRecordCount,
    message: ok ? 'Reset completed' : `Reset incomplete: ${failureReason}`,
  };
}
