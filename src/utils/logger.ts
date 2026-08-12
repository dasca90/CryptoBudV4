import { sanitizeExecutionDisplayText } from '../lib/execution/executionDisplay';
import { RingBuffer, getMemoryPressureState, isNonCriticalUiAudit } from '../core/diagnostics/memoryLifecycle';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'TRADE';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
  source?: string;
}

interface ThrottleEntry {
  count: number;
  lastSuppressed: number;
  lastLogged: number;
}

export function redactCredentialText(input: string): string {
  return input
    .replace(/(["']?(?:apiSecret|api_secret|secret)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:signature|X-MBX-APIKEY)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
    .replace(/(["']?(?:apiKey|api_key)["']?\s*[:=]\s*["']?)([^\s,"'}&]+)/gi, (_match, prefix: string, value: string) => `${prefix}****${value.slice(-4)}`)
    .replace(/([?&]signature=)[^&\s]+/gi, '$1[REDACTED]');
}

function redactCredentialData(value: unknown, depth = 0): unknown {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return redactCredentialText(value);
  if (Array.isArray(value)) return value.map(item => redactCredentialData(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|signature|x-mbx-apikey/i.test(key)) output[key] = '[REDACTED]';
      else if (/api.?key/i.test(key) && typeof nested === 'string') output[key] = `****${nested.slice(-4)}`;
      else output[key] = redactCredentialData(nested, depth + 1);
    }
    return output;
  }
  return value;
}

export interface LoggerStats {
  totalLogged: number;
  totalSuppressed: number;
  currentLogCount: number;
  maxLogCount: number;
  currentInternalAuditCount: number;
  maxInternalAuditCount: number;
  trimCount: number;
  lastMemoryBufferTrimAt: number | null;
  byLevel: Record<LogLevel, { logged: number; suppressed: number }>;
  throttledKeys: number;
}

class Logger {
  private logs = new RingBuffer<LogEntry>(2000);
  private internalAuditLogs = new RingBuffer<LogEntry>(5000);
  private maxLogs = 2000;
  private maxInternalAuditLogs = 5000;
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  private totalLogged = 0;
  private totalSuppressed = 0;
  private lastBufferTrimAuditAt = 0;
  private trimCount = 0;
  private byLevel: Record<LogLevel, { logged: number; suppressed: number }> = {
    INFO: { logged: 0, suppressed: 0 },
    WARN: { logged: 0, suppressed: 0 },
    ERROR: { logged: 0, suppressed: 0 },
    TRADE: { logged: 0, suppressed: 0 },
  };

  // Throttle tracking: throttleKey -> ThrottleEntry
  private throttleMap = new Map<string, ThrottleEntry>();
  private defaultThrottleMs = 5000;

  info(msg: string, data?: unknown) { this.push('INFO', msg, data); }
  warn(msg: string, data?: unknown) { this.push('WARN', msg, data); }
  error(msg: string, data?: unknown) { this.push('ERROR', msg, data); }
  trade(msg: string, data?: unknown) { this.push('TRADE', msg, data); }

  throttled(level: LogLevel, message: string, throttleKey: string, intervalMs?: number, data?: unknown): void {
    // ERROR and TRADE are never suppressed
    if (level === 'ERROR' || level === 'TRADE') {
      this.push(level, message, data);
      return;
    }

    const interval = intervalMs ?? this.defaultThrottleMs;
    const now = Date.now();
    const existing = this.throttleMap.get(throttleKey);

    if (existing) {
      existing.count++;
      if (now - existing.lastLogged < interval) {
        existing.lastSuppressed = now;
        this.totalSuppressed++;
        this.byLevel[level].suppressed++;
        return;
      }
      existing.lastLogged = now;
    } else {
      this.throttleMap.set(throttleKey, { count: 1, lastSuppressed: 0, lastLogged: now });
    }

    // Write the log with suppression count info
    const entry = existing && existing.count > 1
      ? { message: `${message} (suppressed ${existing.count - 1} since last log)`, data }
      : { message, data };
    this.push(level, entry.message, entry.data);
  }

  private push(level: LogLevel, message: string, data?: unknown) {
    message = redactCredentialText(message);
    data = redactCredentialData(data);
    if (level === 'INFO' && getMemoryPressureState().active && isNonCriticalUiAudit(message)) {
      this.totalSuppressed++;
      this.byLevel[level].suppressed++;
      return;
    }
    const source = this.detectSource(message);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level, message, data, source,
    };
    const visibleTrim = this.logs.push(entry).trimmed;
    let auditTrim = 0;
    if (message.includes('_AUDIT') || message.includes('MEMORY_')) {
      auditTrim = this.internalAuditLogs.push(entry).trimmed;
    }
    this.totalLogged++;
    this.byLevel[level].logged++;
    const now = Date.now();
    if (visibleTrim > 0 || auditTrim > 0) {
      this.trimCount += visibleTrim + auditTrim;
    }
    if ((visibleTrim > 0 || auditTrim > 0) && now - this.lastBufferTrimAuditAt > 30000) {
      this.lastBufferTrimAuditAt = now;
      const trimEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'INFO',
        message: `MEMORY_BUFFER_TRIM_AUDIT: visibleTrimmed=${visibleTrim} internalAuditTrimmed=${auditTrim} visibleLogCount=${this.logs.length} visibleLogMax=${this.maxLogs} internalAuditCount=${this.internalAuditLogs.length} internalAuditMax=${this.maxInternalAuditLogs}`,
        source: 'Diagnostics',
      };
      if (!message.startsWith('MEMORY_BUFFER_TRIM_AUDIT')) {
        this.logs.push(trimEntry);
        this.internalAuditLogs.push(trimEntry);
      }
    }
    console.log(`[${entry.timestamp}] [${level}] ${sanitizeExecutionDisplayText(message)}`, data ?? '');
    for (const cb of this.listeners) cb(entry);
  }

  private detectSource(msg: string): string | undefined {
    const firstToken = (msg.split(':')[0] || msg).trim();
    const prefix = firstToken.split('_')[0];
    const sourceByPrefix: Record<string, string> = {
      BINANCE: 'Binance',
      SCANNER: 'Scanner',
      AUTOBOTS: 'AutoBots',
      ENTRY: 'EntryGate',
      BLOCK: 'EntryGate',
      MARKET: 'Market Analyzer',
      V3: 'Market Analyzer',
      GROUP: 'Market Analyzer',
      EXECUTION: 'Execution',
      BEST: 'Execution',
      DEMO: 'Execution',
      PAPER: 'Execution',
      LIVE: 'Execution',
      TP: 'Exit', SL: 'Exit',
      TRAIL: 'Exit', EXIT: 'Exit',
      SELL: 'Exit',
      TELEGRAM: 'Telegram',
      ML: 'ML',
      TRADE: 'Trading',
      UI: 'UI',
      LOGS: 'UI',
      CANDIDATE: 'Scanner',
      REF_PERIOD: 'Scanner',
      RANKING: 'Scanner',
      SCORE: 'Scanner',
      REAL_SCAN: 'Scanner',
      CONFIDENCE: 'Scanner',
      MOMENTUM: 'Scanner',
      STRATEGY: 'Scanner',
      MANUAL: 'Scanner',
      UNIFIED: 'Scanner',
      BUY: 'EntryGate',
      RISK: 'Scanner',
    };
    return sourceByPrefix[prefix];
  }

  subscribe(cb: (entry: LogEntry) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  getLogs(): LogEntry[] { return this.logs.toArray(); }

  getRecentLogs(n = 50): LogEntry[] {
    return this.logs.recent(n);
  }

  getInternalAuditLogs(): LogEntry[] {
    return this.internalAuditLogs.toArray();
  }

  clear() {
    this.logs.clear();
    this.internalAuditLogs.clear();
    this.totalLogged = 0;
    this.totalSuppressed = 0;
    this.throttleMap.clear();
    this.lastBufferTrimAuditAt = 0;
    this.trimCount = 0;
    for (const l of Object.keys(this.byLevel) as LogLevel[]) {
      this.byLevel[l] = { logged: 0, suppressed: 0 };
    }
    for (const cb of this.listeners) cb({ timestamp: '', level: 'INFO', message: '__CLEAR__' });
  }

  export() {
    return JSON.stringify(this.logs.toArray().map(entry => ({
      ...entry,
      message: sanitizeExecutionDisplayText(redactCredentialText(entry.message)),
      data: redactCredentialData(entry.data),
    })), null, 2);
  }

  getStats(): LoggerStats {
    return {
      totalLogged: this.totalLogged,
      totalSuppressed: this.totalSuppressed,
      currentLogCount: this.logs.length,
      maxLogCount: this.maxLogs,
      currentInternalAuditCount: this.internalAuditLogs.length,
      maxInternalAuditCount: this.maxInternalAuditLogs,
      trimCount: this.trimCount,
      lastMemoryBufferTrimAt: this.lastBufferTrimAuditAt > 0 ? this.lastBufferTrimAuditAt : null,
      byLevel: { ...this.byLevel },
      throttledKeys: this.throttleMap.size,
    };
  }

  setMaxLogs(max: number): void {
    this.maxLogs = Math.max(0, max);
    this.logs.trimTo(this.maxLogs);
  }

  setMaxInternalAuditLogs(max: number): void {
    this.maxInternalAuditLogs = Math.max(0, max);
    this.internalAuditLogs.trimTo(this.maxInternalAuditLogs);
  }
}

export const logger = new Logger();
