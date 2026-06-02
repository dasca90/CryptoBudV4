import { sanitizeExecutionDisplayText } from '../lib/execution/executionDisplay';

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

export interface LoggerStats {
  totalLogged: number;
  totalSuppressed: number;
  currentLogCount: number;
  maxLogCount: number;
  byLevel: Record<LogLevel, { logged: number; suppressed: number }>;
  throttledKeys: number;
}

class Logger {
  private logs: LogEntry[] = [];
  private maxLogs = 2000;
  private listeners: Set<(entry: LogEntry) => void> = new Set();

  private totalLogged = 0;
  private totalSuppressed = 0;
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
    const source = this.detectSource(message);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level, message, data, source,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    this.totalLogged++;
    this.byLevel[level].logged++;
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

  getLogs(): LogEntry[] { return [...this.logs]; }

  getRecentLogs(n = 50): LogEntry[] {
    return this.logs.slice(-n);
  }

  clear() {
    this.logs = [];
    this.totalLogged = 0;
    this.totalSuppressed = 0;
    this.throttleMap.clear();
    for (const l of Object.keys(this.byLevel) as LogLevel[]) {
      this.byLevel[l] = { logged: 0, suppressed: 0 };
    }
    for (const cb of this.listeners) cb({ timestamp: '', level: 'INFO', message: '__CLEAR__' });
  }

  export() {
    return JSON.stringify(this.logs.map(entry => ({
      ...entry,
      message: sanitizeExecutionDisplayText(entry.message),
    })), null, 2);
  }

  getStats(): LoggerStats {
    return {
      totalLogged: this.totalLogged,
      totalSuppressed: this.totalSuppressed,
      currentLogCount: this.logs.length,
      maxLogCount: this.maxLogs,
      byLevel: { ...this.byLevel },
      throttledKeys: this.throttleMap.size,
    };
  }

  setMaxLogs(max: number): void {
    this.maxLogs = max;
    while (this.logs.length > this.maxLogs) this.logs.shift();
  }
}

export const logger = new Logger();
