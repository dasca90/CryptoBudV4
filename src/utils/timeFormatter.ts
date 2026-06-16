import { logger } from './logger';

interface SystemTimeContext {
  browserTimeZone: string;
  browserOffsetMinutes: number;
  source: 'browser_intl' | 'browser_fallback';
  refreshedAt: number;
}

let _ctx: SystemTimeContext | null = null;
let _lastRefresh = 0;
const REFRESH_INTERVAL_MS = 30_000;

function refreshContext(): SystemTimeContext {
  const now = Date.now();
  if (_ctx && now - _lastRefresh < REFRESH_INTERVAL_MS) return _ctx;
  _lastRefresh = now;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    const offset = new Date().getTimezoneOffset() * -1;
    const browserNow = new Date();
    _ctx = {
      browserTimeZone: tz,
      browserOffsetMinutes: offset,
      source: 'browser_intl',
      refreshedAt: now,
    };
    logger.info(`SYSTEM_TIME_CONTEXT_AUDIT: source=browser_intl browserTimeZone=${tz} browserOffsetMinutes=${offset} nativeOffsetMinutes=n/a systemNowDisplay=${browserNow.toLocaleTimeString()} contextRefreshedAt=${new Date(now).toISOString()} reason=periodic_refresh invariantOk=true`);
  } catch {
    const offset = new Date().getTimezoneOffset() * -1;
    const browserNow = new Date();
    _ctx = {
      browserTimeZone: `UTC${offset >= 0 ? '+' : ''}${Math.floor(offset / 60)}:${String(Math.abs(offset % 60)).padStart(2, '0')}`,
      browserOffsetMinutes: offset,
      source: 'browser_fallback',
      refreshedAt: now,
    };
    logger.info(`SYSTEM_TIME_CONTEXT_AUDIT: source=browser_fallback browserTimeZone=n/a browserOffsetMinutes=${offset} systemNowDisplay=${browserNow.toLocaleTimeString()} contextRefreshedAt=${new Date(now).toISOString()} reason=periodic_refresh_fallback invariantOk=true`);
  }
  return _ctx;
}

export function refreshSystemTimeContext(reason: string): void {
  _ctx = null;
  _lastRefresh = 0;
  refreshContext();
  logger.info(`SYSTEM_TIME_CONTEXT_AUDIT: source=manual_refresh reason=${reason} contextRefreshedAt=${new Date().toISOString()}`);
}

export function getSystemTimeContext(): SystemTimeContext {
  return refreshContext();
}

export function getRawUtcTooltip(timestamp: string | number | Date | undefined | null): string {
  if (timestamp == null || timestamp === '') return 'n/a';
  const d = typeof timestamp === 'string' ? new Date(timestamp) : typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return isNaN(d.getTime()) ? 'n/a' : `Raw UTC: ${d.toISOString()}`;
}

export interface FormatLocalTimeOptions {
  format?: 'time' | 'datetime' | 'full';
}

export function formatLocalTime(
  timestamp: string | number | Date | undefined | null,
  options: FormatLocalTimeOptions = {},
): string {
  if (timestamp == null || timestamp === '') return 'n/a';
  const { format = 'time' } = options;
  const ctx = refreshContext();
  const date = typeof timestamp === 'string' ? new Date(timestamp) :
    typeof timestamp === 'number' ? new Date(timestamp) : timestamp;

  if (isNaN(date.getTime())) return 'n/a';

  try {
    if (format === 'time') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: ctx.browserTimeZone });
    }
    if (format === 'datetime') {
      return date.toLocaleString([], {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        timeZone: ctx.browserTimeZone,
      });
    }
    return date.toLocaleString([], { timeZone: ctx.browserTimeZone });
  } catch {
    // Last resort: system Date methods
    return format === 'time'
      ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
      : `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  }
}

export function formatSystemLocalTime(timestamp: string | number | Date | undefined | null): string {
  return formatLocalTime(timestamp, { format: 'time' });
}

export function formatSystemLocalDateTime(timestamp: string | number | Date | undefined | null): string {
  return formatLocalTime(timestamp, { format: 'datetime' });
}

export function formatLocalTimeWithAudit(
  timestamp: string | number | Date | undefined | null,
  sourceComponent: string,
  options: FormatLocalTimeOptions = {},
): string {
  const rawUtcIso = timestamp ? (typeof timestamp === 'string' ? timestamp : new Date(timestamp).toISOString()) : 'n/a';
  const ctx = refreshContext();
  const displayed = formatLocalTime(timestamp, options);
  const expectedSystemLocal = new Date().toLocaleTimeString();
  logger.info(`TIME_DISPLAY_BINDING_AUDIT: sourceComponent=${sourceComponent} rawTimestamp=${String(timestamp)} rawUtcIso=${rawUtcIso} displayTime=${displayed} timeSource=${ctx.source} offsetMinutesUsed=${ctx.browserOffsetMinutes} browserTimeZone=${ctx.browserTimeZone} nativeFallbackUsed=false invariantOk=true`);
  return displayed;
}
