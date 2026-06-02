import { logger } from '../../utils/logger';

export interface TauriDiagnosticsResult {
  isBrowser: boolean;
  isTauriGlobalPresent: boolean;
  hasTauriInternals: boolean;
  userAgent: string;
  locationHref: string;
  invokeImportType: string;
  canInvokeGetDbPath: boolean;
  canInvokeGetTradeCount: boolean;
  dbPath: string | null;
  tradeCount: number | null;
  errors: string[];
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}`;
  } catch {
    return url.slice(0, 80);
  }
}

export async function runTauriRuntimeDiagnostics(): Promise<TauriDiagnosticsResult> {
  const errors: string[] = [];
  let invokeImportType = 'not_imported';
  let canInvokeGetDbPath = false;
  let canInvokeGetTradeCount = false;
  let dbPath: string | null = null;
  let tradeCount: number | null = null;

  // Check window/globals
  const isBrowser = typeof window !== 'undefined';
  const isTauriGlobalPresent = isBrowser && !!((window as unknown as Record<string, unknown>).__TAURI__);
  const hasTauriInternals = isBrowser && !!((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
  const userAgent = isBrowser ? window.navigator.userAgent : 'no_window';
  const locationHref = isBrowser ? sanitizeUrl(window.location.href) : 'no_window';

  // Try import invoke
  try {
    const mod = await import('@tauri-apps/api/core');
    if (typeof mod.invoke === 'function') {
      invokeImportType = 'function';
    } else {
      invokeImportType = `typeof_invoke:${typeof mod.invoke}`;
    }
  } catch (importErr) {
    invokeImportType = `import_failed:${importErr instanceof Error ? importErr.message : String(importErr)}`;
    errors.push(`import_failed: ${importErr instanceof Error ? importErr.message : String(importErr)}`);
  }

  // Try get_db_path
  if (invokeImportType === 'function') {
    try {
      const mod = await import('@tauri-apps/api/core');
      dbPath = await mod.invoke<string>('get_db_path');
      canInvokeGetDbPath = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`get_db_path_failed: ${msg}`);
    }

    // Try get_trade_count
    try {
      const mod = await import('@tauri-apps/api/core');
      tradeCount = await mod.invoke<number>('get_trade_count');
      canInvokeGetTradeCount = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`get_trade_count_failed: ${msg}`);
    }
  }

  const result: TauriDiagnosticsResult = {
    isBrowser,
    isTauriGlobalPresent,
    hasTauriInternals,
    userAgent: userAgent.slice(0, 120),
    locationHref,
    invokeImportType,
    canInvokeGetDbPath,
    canInvokeGetTradeCount,
    dbPath,
    tradeCount,
    errors,
  };

  logger.info(`TAURI_RUNTIME_DIAGNOSTICS_RESULT: ${JSON.stringify({
    isBrowser,
    isTauriGlobalPresent,
    hasTauriInternals,
    invokeImportType,
    canInvokeGetDbPath,
    canInvokeGetTradeCount,
    dbPath: dbPath ?? null,
    tradeCount,
    errorCount: errors.length,
  })}`);

  return result;
}
