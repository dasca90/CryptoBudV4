import type { TradeRecord } from '../types';
import type { PersistedAppState } from './AppStatePersistence';
import { logger } from '../../utils/logger';
import { SettingsPersistence } from './SettingsPersistence';
import { buildMLFeatures } from '../ml/ml-feature-builder';
import { sanitizeCredentialArtifact } from '../security/credentialRedaction';

export interface FullBackup {
  schemaVersion: string;
  exportedAt: string;
  appState: PersistedAppState;
  trades: TradeRecord[];
  mlDataset: {
    featureVectors: Array<Record<string, unknown>>;
    counts: Record<string, number>;
  };
  settingsSafety?: {
    apiConfigured: boolean;
    maskedApiKey: string | null;
    savedAt: string | null;
    storageMode: 'secure' | 'tauri_app_state' | 'local_fallback';
    telegramConfigured: boolean;
  };
}

const settingsPersistence = new SettingsPersistence();

export const backupService = {
  async exportFullBackup(
    trades: TradeRecord[],
    appState: PersistedAppState,
  ): Promise<{ json: string; filename: string }> {
    const rows: Record<string, unknown>[] = [];
    for (const t of trades) {
      if (t.closeSnapshot) {
        try {
          rows.push(buildMLFeatures(t) as unknown as Record<string, unknown>);
        } catch { /* skip */ }
      }
    }

    const settings = await settingsPersistence.loadSettings();
    const backup: FullBackup = {
      schemaVersion: 'cryptobud-v4-full-backup-v1',
      exportedAt: new Date().toISOString(),
      appState,
      trades,
      mlDataset: {
        featureVectors: rows,
        counts: {
          totalTrades: trades.length,
          totalFeatures: rows.length,
        },
      },
      settingsSafety: {
        apiConfigured: settings.binanceApiConfigured,
        maskedApiKey: settings.binanceApiKeyMasked,
        savedAt: settings.apiCredentialsSavedAt ?? null,
        storageMode: settings.apiStorageMode ?? 'local_fallback',
        telegramConfigured: settings.telegramBotTokenConfigured && settings.telegramChatIdConfigured,
      },
    };

    const filename = `cryptobud_backup_${new Date().toISOString().split('T')[0]}.json`;
    return { json: JSON.stringify(sanitizeCredentialArtifact(backup), null, 2), filename };
  },

  async importFullBackup(json: string): Promise<FullBackup | null> {
    try {
      const backup = JSON.parse(json) as FullBackup;
      if (!backup.schemaVersion || !backup.trades) {
        logger.warn('BACKUP: Invalid backup format — missing schemaVersion or trades');
        return null;
      }
      logger.info(`BACKUP: Loaded backup v${backup.schemaVersion} with ${backup.trades.length} trades`);
      return backup;
    } catch (err) {
      logger.warn(`BACKUP: Failed to parse backup — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  },

  download(json: string, filename: string): void {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
