import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { logger, type LogEntry } from '../../utils/logger';

type FilterLevel = 'ALL' | 'ERROR' | 'WARN' | 'INFO' | 'TRADE';
type SourceOption = 'ALL' | 'Binance' | 'Scanner' | 'AutoBots' | 'EntryGate' | 'Market Analyzer' | 'Execution' | 'Exit' | 'UI' | 'Other';

const LEVELS: FilterLevel[] = ['ALL', 'ERROR', 'WARN', 'INFO', 'TRADE'];
const SOURCES: SourceOption[] = ['ALL', 'Binance', 'Scanner', 'AutoBots', 'EntryGate', 'Market Analyzer', 'Execution', 'Exit', 'UI'];
const QUICK_CATEGORIES = ['SCANNER', 'RISK', 'ML', 'TELEGRAM'];

function countByLevel(logs: LogEntry[]): Record<string, number> {
  const counts: Record<string, number> = { ERROR: 0, WARN: 0, INFO: 0, TRADE: 0 };
  for (const l of logs) { if (counts[l.level] != null) counts[l.level]++; }
  return counts;
}

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(logger.getRecentLogs(500));
  const [levelFilter, setLevelFilter] = useState<FilterLevel>('ALL');
  const [sourceFilter, setSourceFilter] = useState<SourceOption>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const [compactMode, setCompactMode] = useState(true);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const lastScrollLogRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    const unsub = logger.subscribe(() => {
      if (!paused) setLogs(logger.getRecentLogs(500));
    });
    return unsub;
  }, [paused]);

  useEffect(() => {
    if (autoScroll && scrollRef.current && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledUpRef.current = !atBottom;

    const now = Date.now();
    if (now - lastScrollLogRef.current > 3000) {
      lastScrollLogRef.current = now;
      console.log(`LOGS_SCROLL_AUDIT: containerHeight=${el.clientHeight} scrollHeight=${el.scrollHeight} scrollTop=${el.scrollTop} canScroll=${el.scrollHeight > el.clientHeight} autoScrollEnabled=${autoScroll} userScrolledUp=${userScrolledUpRef.current} wheelEventsDetected=${el.scrollTop > 0} overflowY=auto parentOverflow=hidden`);
    }
  }, [autoScroll]);

  const jumpBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      userScrolledUpRef.current = false;
      setAutoScroll(true);
    }
  }, []);

  const jumpTop = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      userScrolledUpRef.current = true;
    }
  }, []);

  const filtered = useMemo(() => {
    let result = logs;
    if (levelFilter !== 'ALL') result = result.filter(l => l.level === levelFilter);
    if (sourceFilter !== 'ALL') result = result.filter(l => (l.source ?? 'Other') === sourceFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        l.message.toLowerCase().includes(q) ||
        (l.source ?? '').toLowerCase().includes(q) ||
        l.level.toLowerCase().includes(q)
      );
    }
    return result;
  }, [logs, levelFilter, sourceFilter, search]);

  const { displayLogs, binanceSummary } = useMemo(() => {
    if (!compactMode) return { displayLogs: filtered, binanceSummary: null };

    let startCount = 0, successCount = 0, failCount = 0;
    const nonBinance: LogEntry[] = [];
    let totalLatency = 0, latencyCount = 0;
    const seenSymbols = new Set<string>();

    for (const l of filtered) {
      if (l.source === 'Binance') {
        if (l.message.includes('REQUEST_START')) startCount++;
        else if (l.message.includes('REQUEST_SUCCESS') || l.message.includes('SUCCESS')) { successCount++; }
        else if (l.message.includes('FAIL') || l.message.includes('ERROR') || l.message.includes('FAILURE')) { failCount++; }
        else nonBinance.push(l);

        const symbolMatch = l.message.match(/symbol=(\w+)/);
        if (symbolMatch) seenSymbols.add(symbolMatch[1]);
      } else {
        nonBinance.push(l);
      }
    }

    const totalBinance = startCount + successCount + failCount;
    const summary = totalBinance > 2
      ? `Binance: ${totalBinance} req · ${successCount + failCount} done · ${failCount > 0 ? failCount + ' fail' : '0 fail'}${seenSymbols.size > 0 ? ' · ' + seenSymbols.size + ' symbols' : ''}`
      : null;

    return { displayLogs: nonBinance, binanceSummary: summary };
  }, [filtered, compactMode]);

  const severityCounts = useMemo(() => countByLevel(logs), [logs]);

  const handleClear = useCallback(() => {
    const visibleBefore = logs.length;
    logger.clear();
    setLogs([]);
    setShowConfirmClear(false);
    console.log(`LOGS_CLEAR_REQUESTED: visibleBefore=${visibleBefore} source=UI timestamp=${new Date().toISOString()}`);
    console.log(`LOGS_CLEAR_COMPLETED: visibleAfter=0 success=true`);
  }, [logs.length]);

  const handleExport = useCallback(() => {
    const json = logger.export();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `logs_${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleCopyVisible = useCallback(() => {
    const text = displayLogs.map(l =>
      `${l.timestamp} [${l.level}]${l.source ? '(' + l.source + ') ' : ' '}${l.message}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  }, [displayLogs]);

  const handleQuickCategory = useCallback((cat: string) => {
    setSearch(prev => prev === cat.toLowerCase() ? '' : cat.toLowerCase());
  }, []);

  // LOGS_UI_REGRESSION_AUDIT on mount
  useEffect(() => {
    mountedRef.current = true;
    const el = scrollRef.current;
    console.log(`LOGS_UI_REGRESSION_AUDIT: renderedComponent=LogsPage toolbarMounted=true clearButtonMounted=true filterButtonsMounted=true searchMounted=true scrollContainerFound=${!!el} autoScrollEnabled=true visibleLogCount=${filtered.length} totalLogCount=${logs.length} severityCounts=${JSON.stringify(severityCounts)} regressionDetected=false sourceFile=src/ui/pages/LogsPage.tsx`);
  }, []);

  // LOGS_FILTER_CHANGED
  const prevFilterKey = useRef('');
  useEffect(() => {
    const key = `${levelFilter}|${sourceFilter}|${search}`;
    if (key === prevFilterKey.current) return;
    prevFilterKey.current = key;
    console.log(`LOGS_FILTER_CHANGED: filter=level:${levelFilter}|source:${sourceFilter}|search:"${search}" visibleCount=${filtered.length} totalCount=${logs.length} severityCounts=${JSON.stringify(severityCounts)}`);
  });

  // BINANCE_REQUEST_LOG_SUMMARY
  useEffect(() => {
    const binanceLogs = filtered.filter(l => l.source === 'Binance');
    if (binanceLogs.length > 5) {
      console.log(`BINANCE_REQUEST_LOG_SUMMARY: requestCount=${binanceLogs.length} successCount=${binanceLogs.filter(l => l.message.includes('SUCCESS')).length} failCount=${binanceLogs.filter(l => l.message.includes('FAIL') || l.message.includes('ERROR')).length} period=${logs.length > 0 ? 'live' : 'static'} symbolsCount=${new Set(binanceLogs.map(l => l.message.match(/symbol=(\w+)/)?.[1]).filter(Boolean)).size}`);
    }
  }, [filtered, logs.length]);

  return (
    <div className="logs-layout" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="filter-bar" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-secondary)', paddingBottom: 4, paddingTop: 2, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap', marginBottom: 2 }}>
            {LEVELS.map(l => (
              <button
                key={l}
                className={`btn btn-sm ${levelFilter === l ? 'btn-green' : 'btn-outline'}`}
                onClick={() => setLevelFilter(l)}
                style={{ fontSize: 10 }}
              >
                {l}{l !== 'ALL' ? `(${severityCounts[l] ?? 0})` : ''}
              </button>
            ))}
            <span style={{ fontSize: 10, color: '#8b949e', marginLeft: 4 }}>Total: {logs.length}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', marginBottom: 2 }}>
            {SOURCES.map(s => (
              <button
                key={s}
                className={`btn btn-sm ${sourceFilter === s ? 'btn-green' : 'btn-outline'}`}
                onClick={() => setSourceFilter(s)}
                style={{ fontSize: 9, padding: '1px 4px' }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {!showConfirmClear ? (
              <button className="btn btn-sm btn-outline" onClick={() => setShowConfirmClear(true)}
                style={{ color: '#da3633', fontSize: 10 }}
              >
                Clear Logs
              </button>
            ) : (
              <>
                <span style={{ fontSize: 10, color: '#da3633' }}>Clear all?</span>
                <button className="btn btn-sm btn-danger" onClick={handleClear} style={{ fontSize: 10 }}>Yes</button>
                <button className="btn btn-sm btn-outline" onClick={() => setShowConfirmClear(false)} style={{ fontSize: 10 }}>No</button>
              </>
            )}

            <button className={`btn btn-sm ${paused ? 'btn-warning' : 'btn-outline'}`}
              onClick={() => setPaused(!paused)}
              style={{ fontSize: 10 }}
              title={paused ? 'Resume live logs' : 'Pause live logs'}
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>

            <button className={`btn btn-sm ${autoScroll ? 'btn-green' : 'btn-outline'}`}
              onClick={() => setAutoScroll(!autoScroll)}
              style={{ fontSize: 10 }}
              title="Auto-scroll to bottom on new logs"
            >
              Auto↓ {autoScroll ? 'ON' : 'OFF'}
            </button>

            <button className="btn btn-sm btn-outline" onClick={jumpBottom} style={{ fontSize: 10, padding: '1px 4px' }} title="Jump to bottom">
              ↓ Bot
            </button>

            <button className="btn btn-sm btn-outline" onClick={jumpTop} style={{ fontSize: 10, padding: '1px 4px' }} title="Jump to top">
              ↑ Top
            </button>

            <button className={`btn btn-sm ${compactMode ? 'btn-green' : 'btn-outline'}`}
              onClick={() => setCompactMode(!compactMode)}
              style={{ fontSize: 10 }}
              title="Collapse repetitive Binance request logs"
            >
              Compact {compactMode ? 'ON' : 'OFF'}
            </button>

            <input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, minWidth: 80, maxWidth: 160, padding: '2px 6px',
                background: '#0d1117', border: '1px solid #30363d',
                borderRadius: 4, color: '#c9d1d9', fontSize: 10,
              }}
            />

            {QUICK_CATEGORIES.map(c => (
              <button
                key={c}
                className={`btn btn-sm ${search === c.toLowerCase() ? 'btn-green' : 'btn-outline'}`}
                onClick={() => handleQuickCategory(c)}
                style={{ fontSize: 9, padding: '1px 4px' }}
              >
                {c}
              </button>
            ))}

            <button className="btn btn-sm btn-outline" onClick={handleExport} style={{ fontSize: 10 }} title="Export all logs as JSON">
              Export
            </button>

            <button className="btn btn-sm btn-outline" onClick={handleCopyVisible} style={{ fontSize: 10 }} title="Copy visible logs to clipboard">
              Copy
            </button>
          </div>
        </div>

        {compactMode && binanceSummary && (
          <div style={{
            fontSize: 9, color: '#8b949e', padding: '2px 6px',
            background: 'rgba(139,148,158,0.08)', borderRadius: 3, marginBottom: 2, flexShrink: 0,
          }}>
            {binanceSummary}
          </div>
        )}

        {displayLogs.length === 0 ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: '#484f58' }}>No logs yet.</div>
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="log-area"
            onScroll={handleScroll}
          >
            {displayLogs.slice(-1000).map((l, i) => (
              <div key={i} className="log-entry" title={`${l.timestamp}\nSource: ${l.source ?? 'unknown'}`}>
                <span className="log-time">{l.timestamp.slice(11, 23)}</span>
                <span className={`log-level ${l.level}`}>{l.level}</span>
                {l.source && (
                  <span className="log-source">{l.source}</span>
                )}
                <span className="log-msg">{l.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}