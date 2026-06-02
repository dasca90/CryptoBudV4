import { readFileSync } from 'node:fs';
import { logger, type LogEntry } from '../utils/logger';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };
const eq = <T>(a: T, b: T, m: string) => ok(a === b, m);
const neq = <T>(a: T, b: T, m: string) => ok(a !== b, m);

// ── Part A: Source code structure (controls exist in JSX) ──
(() => {
  const logsSrc = readFileSync('src/ui/pages/LogsPage.tsx', 'utf8');

  // A1: Toolbar renders
  ok(logsSrc.includes('Clear Logs'), 'L1 Clear Logs button visible');
  ok(logsSrc.includes('Pause'), 'L2 Pause/Resume button visible');
  ok(logsSrc.includes('Auto↓'), 'L3 Auto-scroll toggle visible');
  ok(logsSrc.includes('↓ Bot'), 'L4 Jump Bottom visible');
  ok(logsSrc.includes('↑ Top'), 'L5 Jump Top visible');
  ok(logsSrc.includes('Export'), 'L6 Export button visible');
  ok(logsSrc.includes('Copy'), 'L7 Copy visible logs button visible');
  ok(logsSrc.includes('Compact'), 'L8 Compact mode toggle visible');
  ok(logsSrc.includes('Search'), 'L9 Search input visible');
  ok(logsSrc.includes('No logs yet'), 'L10 Empty state visible');

  // A2: Severity filters
  ok(logsSrc.includes("'ALL'"), 'L11 ALL filter exists');
  ok(logsSrc.includes("'ERROR'"), 'L12 ERROR filter exists');
  ok(logsSrc.includes("'WARN'"), 'L13 WARN filter exists');
  ok(logsSrc.includes("'INFO'"), 'L14 INFO filter exists');
  ok(logsSrc.includes("'TRADE'"), 'L15 TRADE filter exists');

  // A3: Source filters
  ok(logsSrc.includes("'Binance'"), 'L16 Binance source filter exists');
  ok(logsSrc.includes("'Scanner'"), 'L17 Scanner source filter exists');
  ok(logsSrc.includes("'AutoBots'"), 'L18 AutoBots source filter exists');
  ok(logsSrc.includes("'EntryGate'"), 'L19 EntryGate source filter exists');
  ok(logsSrc.includes("'Execution'"), 'L20 Execution source filter exists');

  // A4: Quick categories
  ok(logsSrc.includes('SCANNER'), 'L21 SCANNER quick search');
  ok(logsSrc.includes('RISK'), 'L22 RISK quick search');
  ok(logsSrc.includes('TELEGRAM'), 'L23 TELEGRAM quick search');

  // A5: logs-layout wrapper and scroll
  ok(logsSrc.includes('logs-layout'), 'L24 logs-layout wrapper');
  ok(logsSrc.includes('page-panel'), 'L25 page-panel wrapper');
  ok(logsSrc.includes('onScroll'), 'L26 onScroll handler for mouse wheel');
  ok(logsSrc.includes('scrollTop'), 'L27 scrollTop property used for scroll');
  ok(logsSrc.includes('scrollHeight'), 'L28 scrollHeight property used');

  // A6: Audit logs in source
  ok(logsSrc.includes('LOGS_UI_REGRESSION_AUDIT'), 'L29 LOGS_UI_REGRESSION_AUDIT present');
  ok(logsSrc.includes('LOGS_CLEAR_REQUESTED'), 'L30 LOGS_CLEAR_REQUESTED present');
  ok(logsSrc.includes('LOGS_CLEAR_COMPLETED'), 'L31 LOGS_CLEAR_COMPLETED present');
  ok(logsSrc.includes('LOGS_SCROLL_AUDIT'), 'L32 LOGS_SCROLL_AUDIT present');
  ok(logsSrc.includes('LOGS_FILTER_CHANGED'), 'L33 LOGS_FILTER_CHANGED present');
  ok(logsSrc.includes('BINANCE_REQUEST_LOG_SUMMARY'), 'L34 BINANCE_REQUEST_LOG_SUMMARY present');

  console.log(`logs-regression source: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
})();

// ── Part B: Runtime logger behavior ──
(async () => {
  const logsSrc = readFileSync('src/ui/pages/LogsPage.tsx', 'utf8');

  // Clear any prior logs
  logger.clear();

  // B1: Log addition and retrieval
  const beforeCount = logger.getLogs().length;
  eq(beforeCount, 0, 'B1 Logger starts empty after clear');
  logger.info('TEST_ENTRY: info message');
  logger.warn('TEST_ENTRY: warn message');
  logger.error('TEST_ENTRY: error message');
  logger.trade('TEST_ENTRY: trade message');
  const afterAdd = logger.getLogs();
  eq(afterAdd.length, 4, 'B2 Four log entries added');
  ok(afterAdd.some(l => l.message.includes('info message')), 'B3 Info message found');
  ok(afterAdd.some(l => l.level === 'ERROR'), 'B4 Error level present');
  ok(afterAdd.some(l => l.level === 'WARN'), 'B5 Warn level present');
  ok(afterAdd.some(l => l.level === 'TRADE'), 'B6 Trade level present');

  // B3: Source auto-detection
  logger.info('BINANCE_REQUEST_START: symbol=BTCUSDT');
  logger.info('SCANNER_ANALYZE: symbol=ETHUSDT');
  logger.info('ENTRY_GATE_EVALUATE: coin=BTCUSDT');
  const binanceLogs = logger.getLogs().filter(l => l.source === 'Binance');
  ok(binanceLogs.length >= 1, 'B7 Binance source auto-detected');
  const scannerLogs = logger.getLogs().filter(l => l.source === 'Scanner');
  ok(scannerLogs.length >= 1, 'B8 Scanner source auto-detected from SCANNER_* prefix');
  const entryGateLogs = logger.getLogs().filter(l => l.source === 'EntryGate');
  ok(entryGateLogs.length >= 1, 'B9 EntryGate source auto-detected from ENTRY_* prefix');

  // B4: getRecentLogs returns correct count
  const recent = logger.getRecentLogs(3);
  ok(recent.length <= 3, 'B10 getRecentLogs(3) returns at most 3 entries');
  ok(recent.length > 0, 'B11 getRecentLogs returns at least 1 entry');

  // B5: Level filtering (simulating LogsPage filter logic)
  const allLogs = logger.getLogs();
  const errorOnly = allLogs.filter(l => l.level === 'ERROR');
  ok(errorOnly.length >= 1, 'B12 ERROR filter works on real logs');
  const warnOnly = allLogs.filter(l => l.level === 'WARN');
  ok(warnOnly.length >= 1, 'B13 WARN filter works on real logs');

  // B6: Source filtering (simulating LogsPage source filter)
  const binanceOnly = allLogs.filter(l => l.source === 'Binance');
  ok(binanceOnly.length >= 1, 'B14 Binance source filter works');

  // B7: Search filtering (simulating LogsPage search)
  const searchResults = allLogs.filter(l => l.message.toLowerCase().includes('btc'));
  ok(searchResults.length >= 1, 'B15 Search filter matches BTC');

  // B8: Logger subscribe notification
  let received: LogEntry | null = null;
  const unsub = logger.subscribe((entry: LogEntry) => { received = entry; });
  logger.info('TEST_SUBSCRIBE: verify notification');
  await new Promise(r => setTimeout(r, 10));
  ok(received !== null && (received as LogEntry).message.includes('TEST_SUBSCRIBE'), 'B16 Subscribe receives new log entries');
  // Unsubscribe and verify no more notifications
  unsub();
  received = null;
  logger.info('TEST_UNSUBSCRIBE: should not be received');
  await new Promise(r => setTimeout(r, 10));
  ok(received === null, 'B17 Unsubscribe stops notifications');

  // B9: Clear removes all logs
  const totalBeforeClear = logger.getLogs().length;
  ok(totalBeforeClear > 0, 'B18 Logs exist before clear');
  logger.clear();
  eq(logger.getLogs().length, 0, 'B19 Clear removes all logs');

  // B10: New logs appear after clear
  logger.info('TEST_POST_CLEAR: first log after clear');
  const postClearCount = logger.getLogs().length;
  eq(postClearCount, 1, 'B20 New log appears after clear (count=1)');
  ok(logger.getLogs()[0].message.includes('TEST_POST_CLEAR'), 'B21 New log is the expected entry');

  // B11: Compact mode source code check
  ok(logsSrc.includes('compactMode'), 'B22 Compact mode toggle in source');

  // B12: Jump Top/Bottom via scrollTop manipulation
  ok(logsSrc.includes('scrollRef.current.scrollTop = scrollRef.current.scrollHeight'), 'B23 Jump Bottom uses scrollTop assignment');
  ok(logsSrc.includes('scrollRef.current.scrollTop = 0'), 'B24 Jump Top uses scrollTop = 0');

  // B13: Auto-scroll toggle
  ok(logsSrc.includes('autoScroll'), 'B25 Auto-scroll toggle state in source');
  ok(logsSrc.includes('setAutoScroll'), 'B26 Auto-scroll setter in source');

  console.log(`logs-regression runtime: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
})();
